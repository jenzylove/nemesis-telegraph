import { readFileSync } from "node:fs";

/**
 * Everything the gateway is allowed to pay for. A challenge that falls outside
 * these bounds is refused before anything is signed, so a compromised or
 * changed router cannot move funds on terms nobody approved.
 */
export type GatewayConfig = {
  engineBaseUrl: string;
  network: string;
  asset: string;
  payee: string;
  maxAmountAtomic: bigint;
  perCallUsd: number;
  perCaseEventUsd: number;
  dailyUsd: number;
  requestTimeoutMs: number;
  registryTtlMs: number;
  internalToken: string;
  firestoreProject: string;
  firestoreDatabase: string;
  payerKey?: string;
  settlementRpcUrl: string;
  port: number;
};

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) throw new Error(`${name} must be a non-negative number`);
  return value;
}

/** Reads the payer key from the environment, falling back to a gitignored file. */
function readPayerKey(): string | undefined {
  const fromEnv = process.env.TELEGRAPH_EVM_PRIVATE_KEY?.trim();
  if (fromEnv) return fromEnv;
  try {
    const raw = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const match = /^\s*(?:export\s+)?TELEGRAPH_EVM_PRIVATE_KEY\s*=\s*(.*)$/.exec(line);
      if (match) return match[1].trim().replace(/^["']|["']$/g, "");
    }
  } catch {
    return undefined;
  }
  return undefined;
}

export function loadConfig(): GatewayConfig {
  return {
    engineBaseUrl: process.env.TELEGRAPH_ENGINE_URL || "http://13.237.89.59:7044/engine",
    network: process.env.TELEGRAPH_NETWORK || "eip155:84532",
    asset: (process.env.TELEGRAPH_ASSET || "0x036CbD53842c5426634e7929541eC2318f3dCF7e").toLowerCase(),
    payee: (process.env.TELEGRAPH_PAYEE || "0x5a2324aA18613FAD4e44bDF0d6c73Ec1f6D87ff8").toLowerCase(),
    maxAmountAtomic: BigInt(process.env.TELEGRAPH_MAX_AMOUNT_ATOMIC || "10000"),
    perCallUsd: num("TELEGRAPH_PER_CALL_USD", 0.01),
    perCaseEventUsd: num("TELEGRAPH_PER_CASE_EVENT_USD", 0.03),
    dailyUsd: num("TELEGRAPH_DAILY_USD", 1.0),
    // Settlement, not inference, dominates the paid round trip. The first
    // settled call took 8.9 s end to end against the miner's 1.0 s.
    requestTimeoutMs: num("TELEGRAPH_REQUEST_TIMEOUT_MS", 45_000),
    registryTtlMs: num("TELEGRAPH_REGISTRY_TTL_MS", 300_000),
    internalToken: process.env.TELEGRAPH_INTERNAL_TOKEN || "",
    // The daily ceiling is only meaningful if it outlives the container, which
    // on Cloud Run is torn down whenever the service goes idle.
    firestoreProject: process.env.FIRESTORE_PROJECT_ID || "",
    firestoreDatabase: process.env.FIRESTORE_DATABASE || "",
    payerKey: readPayerKey(),
    settlementRpcUrl: process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org",
    port: num("PORT", 8081)
  };
}
