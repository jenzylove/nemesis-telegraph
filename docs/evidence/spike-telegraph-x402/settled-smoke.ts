import { writeFile, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { ExactEvmScheme, toClientEvmSigner } from "@x402/evm";
import { wrapFetchWithPayment, x402Client } from "@x402/fetch";
import { createPublicClient, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";

const ENGINE_URL = "http://13.237.89.59:7044/engine/v1/ask";
const REQUESTED_INTENT = "ONCHAIN_TX_LOOKUP";
const SUBJECT_CHAIN = "ethereum";
const SUBJECT_TX = "0xb61413c495fdad6114a7aa863a00b2e3c28945979a10885b12b30316ea9f072c";
const EXPECTED_NETWORK = "eip155:84532";
const EXPECTED_ASSET = "0x036cbd53842c5426634e7929541ec2318f3dcf7e";
const EXPECTED_PAYEE = "0x5a2324aa18613fad4e44bdf0d6c73ec1f6d87ff8";
const MAX_AMOUNT_ATOMIC = 10_000n;
const quoteOnly = process.argv.includes("--quote-only");

/**
 * Reads the payer key from a gitignored .env.local when it is not already in the
 * process environment. The key must never be printed, committed, or shipped to
 * the frontend, so nothing here echoes the value.
 */
async function loadPayerKey(): Promise<string | undefined> {
  const fromEnv = process.env.TELEGRAPH_EVM_PRIVATE_KEY;
  if (fromEnv) return fromEnv.trim();
  try {
    const raw = await readFile(resolve(process.cwd(), ".env.local"), "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const match = /^\s*(?:export\s+)?TELEGRAPH_EVM_PRIVATE_KEY\s*=\s*(.*)$/.exec(line);
      if (!match) continue;
      return match[1].trim().replace(/^["']|["']$/g, "");
    }
  } catch {
    return undefined;
  }
  return undefined;
}

type ChallengeOption = {
  scheme?: string;
  network?: string;
  asset?: string;
  amount?: string;
  payTo?: string;
  maxTimeoutSeconds?: number;
};

type DecodedChallenge = {
  x402Version?: number;
  accepts?: ChallengeOption[];
  resource?: Record<string, unknown>;
  error?: string;
};

const requestBody = {
  query: `Look up Ethereum transaction ${SUBJECT_TX}. Report its on-chain status and effects.`,
  context: {
    requested_intent: REQUESTED_INTENT,
    intent: REQUESTED_INTENT,
    chain: SUBJECT_CHAIN,
    transaction_hash: SUBJECT_TX,
    evidence_boundary: "NEMESIS JSON-RPC evidence remains authoritative; return external comparison only."
  }
};

function decodeHeader(value: string): DecodedChallenge {
  return JSON.parse(Buffer.from(value, "base64").toString("utf8")) as DecodedChallenge;
}

function readChallenge(response: Response): { decoded: DecodedChallenge; header: string } {
  const header = response.headers.get("payment-required");
  if (!header) throw new Error("Telegraph 402 omitted PAYMENT-REQUIRED");
  return { decoded: decodeHeader(header), header };
}

function validateChallenge(decoded: DecodedChallenge): ChallengeOption {
  if (decoded.x402Version !== 2) throw new Error(`Rejected x402 version ${String(decoded.x402Version)}`);
  const baseOptions = (decoded.accepts ?? []).filter((item) => item.network === EXPECTED_NETWORK);
  if (baseOptions.length !== 1) throw new Error(`Expected exactly one ${EXPECTED_NETWORK} offer`);
  const option = baseOptions[0];
  if (option.scheme !== "exact") throw new Error(`Rejected scheme ${String(option.scheme)}`);
  if (option.asset?.toLowerCase() !== EXPECTED_ASSET) throw new Error(`Rejected asset ${String(option.asset)}`);
  if (option.payTo?.toLowerCase() !== EXPECTED_PAYEE) throw new Error(`Rejected payee ${String(option.payTo)}`);
  const amount = BigInt(option.amount ?? "-1");
  if (amount < 0n || amount > MAX_AMOUNT_ATOMIC) throw new Error(`Rejected amount ${amount.toString()}`);
  return option;
}

function publicOption(option: ChallengeOption) {
  return {
    scheme: option.scheme ?? null,
    network: option.network ?? null,
    asset: option.asset ?? null,
    amount_atomic: option.amount ?? null,
    amount_usdc: option.amount ? (Number(option.amount) / 1_000_000).toFixed(2) : null,
    pay_to: option.payTo ?? null,
    max_timeout_seconds: option.maxTimeoutSeconds ?? null
  };
}

function decodePaymentResponse(value: string | null): unknown {
  if (!value) return null;
  try {
    return JSON.parse(Buffer.from(value, "base64").toString("utf8"));
  } catch {
    return { encoding: "opaque", value };
  }
}

function findTransactionReference(value: unknown): Hex | null {
  if (!value || typeof value !== "object") return null;
  const queue: unknown[] = [value];
  while (queue.length) {
    const current = queue.shift();
    if (!current || typeof current !== "object") continue;
    for (const [key, item] of Object.entries(current)) {
      if (["transaction", "transactionHash", "txHash", "tx_hash"].includes(key) &&
          typeof item === "string" && /^0x[0-9a-fA-F]{64}$/.test(item)) return item as Hex;
      if (item && typeof item === "object") queue.push(item);
    }
  }
  return null;
}

function redactSensitiveHeaders(headers: Headers): Record<string, string> {
  const allowed = new Set(["content-type", "date", "payment-required", "payment-response"]);
  return Object.fromEntries([...headers.entries()].filter(([name]) => allowed.has(name.toLowerCase())));
}

async function main() {
  const startedAt = new Date();
  const started = performance.now();
  const initial = await fetch(ENGINE_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(requestBody)
  });
  if (initial.status !== 402) throw new Error(`Expected initial HTTP 402, received ${initial.status}`);
  const initialChallenge = readChallenge(initial);
  const approvedOption = validateChallenge(initialChallenge.decoded);

  if (quoteOnly) {
    process.stdout.write(JSON.stringify({
      status: "quote_validated",
      endpoint: ENGINE_URL,
      requested_intent: REQUESTED_INTENT,
      subject: { chain: SUBJECT_CHAIN, transaction_hash: SUBJECT_TX },
      approved_offer: publicOption(approvedOption)
    }, null, 2) + "\n");
    return;
  }

  const privateKey = await loadPayerKey();
  if (!privateKey || !/^0x[0-9a-fA-F]{64}$/.test(privateKey)) {
    throw new Error("TELEGRAPH_EVM_PRIVATE_KEY is missing or invalid");
  }

  const account = privateKeyToAccount(privateKey as Hex);
  const paymentClient = x402Client.fromConfig({
    schemes: [{
      network: EXPECTED_NETWORK,
      client: new ExactEvmScheme(toClientEvmSigner(account))
    }]
  });

  const paidChallenge: { current: DecodedChallenge | null } = { current: null };
  const guardedFetch: typeof fetch = async (input, init) => {
    const response = await fetch(input, init);
    if (response.status === 402) {
      const challenge = readChallenge(response);
      validateChallenge(challenge.decoded);
      paidChallenge.current = challenge.decoded;
    }
    return response;
  };
  const fetchWithPayment = wrapFetchWithPayment(guardedFetch, paymentClient);
  const response = await fetchWithPayment(ENGINE_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(requestBody)
  });
  const responseText = await response.text();
  let responseBody: unknown;
  try { responseBody = JSON.parse(responseText); } catch { responseBody = responseText; }

  const paymentHeader = response.headers.get("payment-response");
  const paymentResponse = decodePaymentResponse(paymentHeader);
  const settlementReference = findTransactionReference(paymentResponse);
  let settlementVerification: unknown = null;
  if (settlementReference) {
    const publicClient = createPublicClient({
      chain: baseSepolia,
      transport: http(process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org")
    });
    const [tx, receipt] = await Promise.all([
      publicClient.getTransaction({ hash: settlementReference }),
      publicClient.getTransactionReceipt({ hash: settlementReference })
    ]);
    settlementVerification = {
      network: EXPECTED_NETWORK,
      transaction_hash: settlementReference,
      receipt_status: receipt.status,
      block_number: receipt.blockNumber.toString(),
      transaction_to: tx.to,
      transaction_from: tx.from
    };
  }

  const bodyObject = responseBody && typeof responseBody === "object" ? responseBody as Record<string, unknown> : {};
  const resultObject = bodyObject.result && typeof bodyObject.result === "object" ? bodyObject.result as Record<string, unknown> : {};
  const evidence = {
    schema_version: "1.0",
    observed_at_utc: new Date().toISOString(),
    started_at_utc: startedAt.toISOString(),
    endpoint: ENGINE_URL,
    request: {
      requested_intent: REQUESTED_INTENT,
      subject: { chain: SUBJECT_CHAIN, transaction_hash: SUBJECT_TX },
      body: requestBody
    },
    challenge: {
      x402_version: paidChallenge.current?.x402Version ?? initialChallenge.decoded.x402Version ?? null,
      approved_offer: publicOption(approvedOption)
    },
    response: {
      http_status: response.status,
      headers: redactSensitiveHeaders(response.headers),
      miner_id: bodyObject.miner_id ?? bodyObject.miner_used ?? null,
      miner_name: bodyObject.miner_name ?? null,
      returned_intent: bodyObject.intent ?? null,
      result: bodyObject.result ?? responseBody,
      reported_cost_usd: bodyObject.cost_usd ?? null,
      reported_duration_ms: bodyObject.duration_ms ?? null,
      end_to_end_latency_ms: Math.round(performance.now() - started),
      signal_hash: bodyObject.signal_hash ?? resultObject.signal_hash ?? null,
      verification: bodyObject.verification ?? resultObject.verification ?? null,
      router_fallback: bodyObject.fallback ?? bodyObject.routing ?? null
    },
    payment: {
      payment_response_header_present: paymentHeader !== null,
      payment_response: paymentResponse,
      settlement_reference: settlementReference,
      independently_verified: settlementVerification
    },
    evidence_boundary: "Real Telegraph-routed x402 call. NEMESIS JSON-RPC remains authoritative for blockchain facts."
  };

  const outputPath = resolve(process.cwd(), "../../docs/evidence/telegraph-settled-smoke-2026-09-05.json");
  await writeFile(outputPath, JSON.stringify(evidence, null, 2) + "\n", { encoding: "utf8", flag: "wx" });
  process.stdout.write(JSON.stringify({
    evidence_file: outputPath,
    http_status: response.status,
    miner_id: evidence.response.miner_id,
    miner_name: evidence.response.miner_name,
    returned_intent: evidence.response.returned_intent,
    reported_cost_usd: evidence.response.reported_cost_usd,
    end_to_end_latency_ms: evidence.response.end_to_end_latency_ms,
    settlement_reference: evidence.payment.settlement_reference,
    signal_hash: evidence.response.signal_hash
  }, null, 2) + "\n");

  if (!response.ok) process.exitCode = 1;
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
