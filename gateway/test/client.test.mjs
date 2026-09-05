import test from "node:test";
import assert from "node:assert/strict";
import { TelegraphClient } from "../dist/telegraph.js";
import { MinerRegistry } from "../dist/registry.js";
import { SpendLedger } from "../dist/spend.js";

// A throwaway key that holds nothing anywhere. It exists only so the client
// builds a signer; every case below returns before a signature is produced.
const THROWAWAY_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";

const config = {
  engineBaseUrl: "http://engine/engine",
  network: "eip155:84532",
  asset: "0x036cbd53842c5426634e7929541ec2318f3dcf7e",
  payee: "0x5a2324aa18613fad4e44bdf0d6c73ec1f6d87ff8",
  maxAmountAtomic: 10000n,
  perCallUsd: 0.01,
  perCaseEventUsd: 0.03,
  dailyUsd: 1,
  requestTimeoutMs: 5000,
  registryTtlMs: 1000,
  internalToken: "t",
  payerKey: THROWAWAY_KEY,
  settlementRpcUrl: "http://rpc",
  port: 0
};

function challengeResponse(overrides = {}) {
  const body = {
    x402Version: 2,
    accepts: [
      {
        scheme: "exact",
        network: "eip155:84532",
        asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
        amount: "10000",
        payTo: "0x5a2324aA18613FAD4e44bDF0d6c73Ec1f6D87ff8",
        maxTimeoutSeconds: 60
      }
    ],
    ...overrides
  };
  return new Response(JSON.stringify(body), {
    status: 402,
    headers: { "payment-required": Buffer.from(JSON.stringify(body), "utf8").toString("base64") }
  });
}

const request = {
  idempotency_key: "k",
  case_id: "NMS-1",
  branch_id: "BR-1",
  trigger: "MOVEMENT_DETECTED",
  intent: "ONCHAIN_TX_LOOKUP",
  query: "look up a transaction"
};

function build(fetchImpl, ledger) {
  const registry = new MinerRegistry(config, fetchImpl, () => 0);
  return new TelegraphClient(
    config,
    registry,
    ledger ?? new SpendLedger({ perCallUsd: 0.01, perCaseEventUsd: 0.03, dailyUsd: 1 }),
    fetchImpl
  );
}

test("a router that does not quote is reported, not paid", async () => {
  const client = build(async () => new Response("{}", { status: 500 }));
  const receipt = await client.enrich(request);
  assert.equal(receipt.status, "failed");
  assert.equal(receipt.error_code, "ROUTER_HTTP_ERROR");
  assert.equal(receipt.payment, null);
});

test("an unreachable router yields a failed receipt rather than throwing", async () => {
  const client = build(async () => { throw new Error("connect ECONNREFUSED"); });
  const receipt = await client.enrich(request);
  assert.equal(receipt.status, "failed");
  assert.equal(receipt.error_code, "ROUTER_UNREACHABLE");
});

test("a challenge outside the allowlist is refused before signing", async () => {
  const client = build(async () =>
    challengeResponse({
      accepts: [
        {
          scheme: "exact",
          network: "eip155:84532",
          asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
          amount: "10000",
          payTo: "0x000000000000000000000000000000000000dead"
        }
      ]
    })
  );
  const receipt = await client.enrich(request);
  assert.equal(receipt.error_code, "CHALLENGE_REJECTED");
  assert.match(receipt.error, /Rejected payee/);
});

test("a quote above the remaining budget is refused before signing", async () => {
  const ledger = new SpendLedger({ perCallUsd: 0.01, perCaseEventUsd: 0.03, dailyUsd: 1 });
  for (let i = 0; i < 3; i += 1) ledger.record("NMS-1:MOVEMENT_DETECTED", 0.01);
  const client = build(async () => challengeResponse(), ledger);
  const receipt = await client.enrich(request);
  assert.equal(receipt.error_code, "SPEND_LIMIT_EXCEEDED");
  assert.equal(receipt.quoted_cost_usdc, "0.010000");
  assert.equal(receipt.payment, null);
});

test("a missing payer key never reaches the network", async () => {
  let called = 0;
  const registry = new MinerRegistry(config, async () => new Response("{}"), () => 0);
  const client = new TelegraphClient(
    { ...config, payerKey: undefined },
    registry,
    new SpendLedger({ perCallUsd: 0.01, perCaseEventUsd: 0.03, dailyUsd: 1 }),
    async () => { called += 1; return new Response("{}"); }
  );
  const receipt = await client.enrich(request);
  assert.equal(receipt.error_code, "PAYER_UNAVAILABLE");
  assert.equal(called, 0);
  assert.equal(client.status().payer_configured, false);
});

test("status reports the payer address without exposing the key", () => {
  const client = build(async () => challengeResponse());
  const status = client.status();
  assert.equal(status.payer_configured, true);
  assert.match(status.payer_address, /^0x[0-9a-fA-F]{40}$/);
  assert.equal(JSON.stringify(status).includes(THROWAWAY_KEY.slice(2)), false);
});

test("enrichments queue rather than paying in parallel", async () => {
  let concurrent = 0;
  let peak = 0;
  const client = build(async () => {
    concurrent += 1;
    peak = Math.max(peak, concurrent);
    await new Promise((resolve) => setTimeout(resolve, 5));
    concurrent -= 1;
    return new Response("{}", { status: 500 });
  });
  await Promise.all([client.enrich(request), client.enrich(request), client.enrich(request)]);
  assert.equal(peak, 1);
});
