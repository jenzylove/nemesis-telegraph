import { createHash } from "node:crypto";

export type TransportReceipt = {
  status: "succeeded" | "failed";
  routing_mode: "routed" | "direct_fallback" | "none";
  fallback_reason: string | null;
  requested_intent: string;
  returned_intent: string | null;
  intent_matched: boolean | null;
  miner_id: string | null;
  miner_name: string | null;
  result: unknown;
  quoted_cost_usdc: string | null;
  // The terms actually approved on the signed challenge. These are observed
  // values, not defaults: the asset and network a payment settled in belong on
  // the receipt as much as the amount does.
  challenge: {
    scheme: string | null;
    network: string | null;
    asset: string | null;
    amount_atomic: string | null;
    amount_usdc: string | null;
    pay_to: string | null;
    max_timeout_seconds: number | null;
  } | null;
  reported_cost_usd: number | null;
  reported_duration_ms: number | null;
  duration_ms: number;
  signal_hash: string | null;
  verification: unknown;
  payment: {
    network: string | null;
    payer: string | null;
    settlement_transaction: string | null;
    settled: boolean;
  } | null;
  raw_response_hash: string | null;
  registry_observed_at: string | null;
  error_code: string | null;
  error: string | null;
  created_at: string;
};

export function hashRaw(value: unknown): string {
  return "sha256:" + createHash("sha256").update(JSON.stringify(value ?? null)).digest("hex");
}

/** Decodes PAYMENT-RESPONSE, keeping the opaque original when it is not JSON. */
export function decodePaymentResponse(value: string | null): unknown {
  if (!value) return null;
  try {
    return JSON.parse(Buffer.from(value, "base64").toString("utf8"));
  } catch {
    return { encoding: "opaque", value };
  }
}

const HASH = /^0x[0-9a-fA-F]{64}$/;

/** Finds a settlement transaction hash anywhere in the payment envelope. */
export function findSettlementReference(value: unknown): string | null {
  const queue: unknown[] = [value];
  while (queue.length) {
    const current = queue.shift();
    if (!current || typeof current !== "object") continue;
    for (const [key, item] of Object.entries(current)) {
      if (["transaction", "transactionHash", "txHash", "tx_hash"].includes(key) && typeof item === "string" && HASH.test(item)) {
        return item;
      }
      if (item && typeof item === "object") queue.push(item);
    }
  }
  return null;
}

function pickString(source: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value) return value;
    if (typeof value === "number") return String(value);
  }
  return null;
}

function pickNumber(source: Record<string, unknown>, ...keys: string[]): number | null {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return null;
}

/**
 * Normalizes an inference response into the frozen contract. Fields that the
 * response does not carry stay null: a synthesized signal hash or verification
 * flag would be indistinguishable from a real one downstream.
 */
export function normalizeResponse(body: unknown, requestedIntent: string) {
  const root = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const result = root.result && typeof root.result === "object" ? (root.result as Record<string, unknown>) : {};
  const returnedIntent = pickString(root, "intent", "detected_intent");
  return {
    miner_id: pickString(root, "miner_id", "miner_used"),
    miner_name: pickString(root, "miner_name"),
    returned_intent: returnedIntent,
    intent_matched: returnedIntent === null ? null : returnedIntent.toUpperCase() === requestedIntent.toUpperCase(),
    result: root.result ?? body,
    reported_cost_usd: pickNumber(root, "cost_usd"),
    reported_duration_ms: pickNumber(root, "duration_ms"),
    signal_hash: pickString(root, "signal_hash") ?? pickString(result, "signal_hash"),
    verification: root.verification ?? result.verification ?? null
  };
}
