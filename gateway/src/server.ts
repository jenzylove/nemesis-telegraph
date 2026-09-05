import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { loadConfig } from "./config.js";
import { MinerRegistry } from "./registry.js";
import { SpendLedger } from "./spend.js";
import { TelegraphClient, type EnrichRequest } from "./telegraph.js";

const config = loadConfig();
const registry = new MinerRegistry(config);
const ledger = new SpendLedger({
  perCallUsd: config.perCallUsd,
  perCaseEventUsd: config.perCaseEventUsd,
  dailyUsd: config.dailyUsd
});
const client = new TelegraphClient(config, registry, ledger);

function send(response: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  response.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(payload) });
  response.end(payload);
}

/**
 * Application-level auth, checked in constant time so the token cannot be
 * probed by timing.
 *
 * On Cloud Run this sits behind IAM, which consumes the Authorization header
 * for its own OIDC token. The shared secret therefore travels in its own
 * header, and Authorization is accepted only as a local-development fallback.
 */
function authorized(request: IncomingMessage): boolean {
  if (!config.internalToken) return false;
  const dedicated = request.headers["x-telegraph-token"];
  const fromHeader = Array.isArray(dedicated) ? dedicated[0] : dedicated;
  const presented = Buffer.from(fromHeader ?? (request.headers.authorization ?? "").replace(/^Bearer\s+/i, ""));
  const expected = Buffer.from(config.internalToken);
  return presented.length === expected.length && timingSafeEqual(presented, expected);
}

async function readBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += (chunk as Buffer).length;
    if (size > 256 * 1024) throw new Error("request body too large");
    chunks.push(chunk as Buffer);
  }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
}

/** Rejects a malformed enrichment before it can reach the payment path. */
function parseEnrich(body: unknown): EnrichRequest {
  const source = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const required = ["idempotency_key", "case_id", "trigger", "intent", "query"] as const;
  for (const field of required) {
    if (typeof source[field] !== "string" || !(source[field] as string).trim()) {
      throw new Error("missing or empty field: " + field);
    }
  }
  return {
    idempotency_key: source.idempotency_key as string,
    case_id: source.case_id as string,
    branch_id: typeof source.branch_id === "string" ? source.branch_id : null,
    trigger: source.trigger as string,
    intent: source.intent as string,
    query: source.query as string,
    context: source.context && typeof source.context === "object" ? (source.context as Record<string, unknown>) : {}
  };
}

const server = createServer((request, response) => {
  void (async () => {
    const url = new URL(request.url ?? "/", "http://localhost");

    if (request.method === "GET" && url.pathname === "/health") {
      const registryHealth = await registry.health();
      const status = client.status();
      send(response, 200, {
        status: status.payer_configured && registryHealth.reachable ? "ok" : "degraded",
        runtime: "nemesis-telegraph-gateway",
        git_sha: process.env.GIT_SHA ?? "unknown",
        enabled: status.payer_configured,
        network: config.network,
        registry: registryHealth,
        ...status
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/internal/telegraph/enrich") {
      if (!authorized(request)) {
        send(response, 401, { error: "unauthorized" });
        return;
      }
      let parsed: EnrichRequest;
      try {
        parsed = parseEnrich(await readBody(request));
      } catch (error) {
        send(response, 400, { error: error instanceof Error ? error.message : "invalid request" });
        return;
      }
      // A failed enrichment is a 200 carrying a failed receipt. NEMESIS must
      // persist the failure rather than retry blindly into another payment.
      send(response, 200, await client.enrich(parsed));
      return;
    }

    send(response, 404, { error: "not found" });
  })().catch((error) => {
    send(response, 500, { error: error instanceof Error ? error.message : "internal error" });
  });
});

server.listen(config.port, () => {
  process.stdout.write(
    JSON.stringify({
      message: "telegraph gateway listening",
      port: config.port,
      network: config.network,
      payer_configured: client.payerAddress !== null,
      payer_address: client.payerAddress
    }) + "\n"
  );
});
