import type { GatewayConfig } from "./config.js";

export type ChallengeOption = {
  scheme?: string;
  network?: string;
  asset?: string;
  amount?: string;
  payTo?: string;
  maxTimeoutSeconds?: number;
};

export type DecodedChallenge = {
  x402Version?: number;
  accepts?: ChallengeOption[];
  resource?: Record<string, unknown>;
  error?: string;
};

export class ChallengeRejected extends Error {
  readonly code = "CHALLENGE_REJECTED";
}

export function decodeChallengeHeader(value: string): DecodedChallenge {
  return JSON.parse(Buffer.from(value, "base64").toString("utf8")) as DecodedChallenge;
}

export function readChallenge(response: Response): DecodedChallenge {
  const header = response.headers.get("payment-required");
  if (!header) throw new ChallengeRejected("Telegraph 402 omitted PAYMENT-REQUIRED");
  return decodeChallengeHeader(header);
}

/**
 * Approves exactly one offer or refuses the whole challenge. Every rejection
 * happens before a signature exists, which is the only point where refusing
 * still costs nothing.
 */
export function validateChallenge(decoded: DecodedChallenge, config: GatewayConfig): ChallengeOption {
  if (decoded.x402Version !== 2) throw new ChallengeRejected(`Rejected x402 version ${String(decoded.x402Version)}`);
  const matching = (decoded.accepts ?? []).filter((item) => item.network === config.network);
  if (matching.length !== 1) throw new ChallengeRejected(`Expected exactly one ${config.network} offer, saw ${matching.length}`);
  const option = matching[0];
  if (option.scheme !== "exact") throw new ChallengeRejected(`Rejected scheme ${String(option.scheme)}`);
  if (option.asset?.toLowerCase() !== config.asset) throw new ChallengeRejected(`Rejected asset ${String(option.asset)}`);
  if (option.payTo?.toLowerCase() !== config.payee) throw new ChallengeRejected(`Rejected payee ${String(option.payTo)}`);
  let amount: bigint;
  try {
    amount = BigInt(option.amount ?? "-1");
  } catch {
    throw new ChallengeRejected(`Rejected unparsable amount ${String(option.amount)}`);
  }
  if (amount < 0n) throw new ChallengeRejected(`Rejected negative amount ${amount.toString()}`);
  if (amount > config.maxAmountAtomic) {
    throw new ChallengeRejected(`Rejected amount ${amount.toString()} above ceiling ${config.maxAmountAtomic.toString()}`);
  }
  return option;
}

/** Atomic USDC units to a decimal string. Six decimals, no floating point. */
export function atomicToUsdc(amount: string): string {
  const value = BigInt(amount);
  const whole = value / 1_000_000n;
  const fraction = (value % 1_000_000n).toString().padStart(6, "0");
  return `${whole.toString()}.${fraction}`;
}

/** The parts of an offer that are safe to log and persist. */
export function publicOffer(option: ChallengeOption) {
  return {
    scheme: option.scheme ?? null,
    network: option.network ?? null,
    asset: option.asset ?? null,
    amount_atomic: option.amount ?? null,
    amount_usdc: option.amount ? atomicToUsdc(option.amount) : null,
    pay_to: option.payTo ?? null,
    max_timeout_seconds: option.maxTimeoutSeconds ?? null
  };
}
