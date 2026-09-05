import { ExactEvmScheme, toClientEvmSigner } from "@x402/evm";
import { wrapFetchWithPayment, x402Client } from "@x402/fetch";
import { privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";
import { ChallengeRejected, publicOffer, readChallenge, validateChallenge, type ChallengeOption } from "./challenge.js";
import type { GatewayConfig } from "./config.js";
import type { MinerRegistry } from "./registry.js";
import { decodePaymentResponse, findSettlementReference, hashRaw, normalizeResponse, type TransportReceipt } from "./receipt.js";
import { SerialQueue, SpendLedger, SpendLimitExceeded } from "./spend.js";
import { DurableDailySpend } from "./durable-spend.js";

export type EnrichRequest = {
  idempotency_key: string;
  case_id: string;
  branch_id?: string | null;
  trigger: string;
  intent: string;
  query: string;
  context?: Record<string, unknown>;
};

export class TelegraphClient {
  private readonly queue = new SerialQueue();
  private readonly payer: ReturnType<typeof privateKeyToAccount> | null;
  private lastSuccess: { at: string; miner_id: string | null; cost_usd: number | null } | null = null;
  private recentFailures = 0;

  constructor(
    private readonly config: GatewayConfig,
    private readonly registry: MinerRegistry,
    private readonly ledger: SpendLedger,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly durable: DurableDailySpend | null = null
  ) {
    this.payer =
      config.payerKey && /^0x[0-9a-fA-F]{64}$/.test(config.payerKey)
        ? privateKeyToAccount(config.payerKey as Hex)
        : null;
  }

  get payerAddress(): string | null {
    return this.payer?.address ?? null;
  }

  async durableSpend(): Promise<number | null> {
    return this.durable?.configured ? this.durable.total() : null;
  }

  status() {
    return {
      payer_configured: this.payer !== null,
      payer_address: this.payerAddress,
      last_success: this.lastSuccess,
      recent_failure_count: this.recentFailures,
      payments_queued: this.queue.pending,
      spend: this.ledger.snapshot()
    };
  }

  /**
   * One logical enrichment. Payments are serialized, the routed endpoint is
   * tried first because Track 3 is about the ranked demand flywheel, and a
   * direct call is attempted only when routing observably failed.
   */
  async enrich(request: EnrichRequest): Promise<TransportReceipt> {
    return this.queue.run(() => this.attempt(request));
  }

  private async attempt(request: EnrichRequest): Promise<TransportReceipt> {
    const startedAt = performance.now();
    const routed = await this.call(this.config.engineBaseUrl + "/v1/ask", request, "routed", null, startedAt);
    if (routed.status === "succeeded" && routed.intent_matched !== false) return routed;
    if (!this.canFallback(routed)) return routed;

    let candidate;
    try {
      candidate = await this.registry.fallbackCandidate(request.intent, routed.miner_id);
    } catch {
      return routed;
    }
    if (!candidate) return routed;

    const reason = routed.status === "failed" ? routed.error_code ?? "ROUTED_FAILED" : "INTENT_MISMATCH";
    const direct = await this.call(
      this.config.engineBaseUrl + "/v1/ask/" + encodeURIComponent(candidate.miner_id),
      request,
      "direct_fallback",
      reason,
      startedAt
    );
    // A fallback that also failed is less informative than the routed attempt,
    // which is the one that describes what the router actually did.
    return direct.status === "succeeded" ? direct : { ...routed, fallback_reason: reason };
  }

  /** Only observable routing failures justify paying a second time. */
  private canFallback(receipt: TransportReceipt): boolean {
    if (receipt.intent_matched === false) return true;
    return receipt.status === "failed" && ["ROUTER_HTTP_ERROR", "ROUTER_TIMEOUT", "ROUTER_UNREACHABLE"].includes(receipt.error_code ?? "");
  }

  private base(request: EnrichRequest, mode: TransportReceipt["routing_mode"], fallbackReason: string | null, startedAt: number): TransportReceipt {
    return {
      status: "failed",
      routing_mode: mode,
      fallback_reason: fallbackReason,
      requested_intent: request.intent,
      returned_intent: null,
      intent_matched: null,
      miner_id: null,
      miner_name: null,
      result: null,
      quoted_cost_usdc: null,
      reported_cost_usd: null,
      reported_duration_ms: null,
      duration_ms: Math.round(performance.now() - startedAt),
      signal_hash: null,
      verification: null,
      payment: null,
      raw_response_hash: null,
      registry_observed_at: null,
      error_code: null,
      error: null,
      created_at: new Date().toISOString()
    };
  }

  private async call(
    url: string,
    request: EnrichRequest,
    mode: TransportReceipt["routing_mode"],
    fallbackReason: string | null,
    startedAt: number
  ): Promise<TransportReceipt> {
    const receipt = this.base(request, mode, fallbackReason, startedAt);
    const fail = (code: string, message: string): TransportReceipt => ({
      ...receipt,
      error_code: code,
      error: message,
      duration_ms: Math.round(performance.now() - startedAt)
    });

    if (!this.payer) return fail("PAYER_UNAVAILABLE", "No payer key is configured");

    const body = JSON.stringify({
      query: request.query,
      context: { ...(request.context ?? {}), requested_intent: request.intent, intent: request.intent }
    });
    const headers = { "content-type": "application/json" };

    // Quote first. The unpaid challenge is the authoritative price, and it is
    // checked against the allowlist and the ceilings before a signer is built.
    let approved: ChallengeOption;
    try {
      const probe = await this.fetchImpl(url, { method: "POST", headers, body, signal: AbortSignal.timeout(this.config.requestTimeoutMs) });
      if (probe.status !== 402) {
        return fail("ROUTER_HTTP_ERROR", "Expected a 402 quote, received HTTP " + probe.status);
      }
      approved = validateChallenge(readChallenge(probe), this.config);
    } catch (error) {
      if (error instanceof ChallengeRejected) {
        this.recentFailures += 1;
        return fail("CHALLENGE_REJECTED", error.message);
      }
      const message = error instanceof Error ? error.message : String(error);
      const timedOut = message.includes("timed out") || message.includes("aborted");
      return fail(timedOut ? "ROUTER_TIMEOUT" : "ROUTER_UNREACHABLE", message);
    }

    const offer = publicOffer(approved);
    const quotedUsd = Number(offer.amount_usdc ?? "0");
    const caseEventKey = request.case_id + ":" + request.trigger;
    try {
      this.ledger.authorize(caseEventKey, quotedUsd);
    } catch (error) {
      if (error instanceof SpendLimitExceeded) {
        return { ...fail("SPEND_LIMIT_EXCEEDED", error.message), quoted_cost_usdc: offer.amount_usdc };
      }
      throw error;
    }

    // The in-memory ledger only knows this container's lifetime. The durable
    // counter is what actually bounds the day, and a counter that cannot be
    // read is a refusal: unknown spend is never treated as no spend.
    if (this.durable?.configured) {
      const spentToday = await this.durable.total();
      if (spentToday === null) {
        return {
          ...fail("SPEND_LEDGER_UNAVAILABLE", "Daily spend could not be read, so payment is refused"),
          quoted_cost_usdc: offer.amount_usdc
        };
      }
      if (spentToday + quotedUsd > this.config.dailyUsd) {
        return {
          ...fail(
            "SPEND_LIMIT_EXCEEDED",
            "Daily spend would reach " + (spentToday + quotedUsd).toFixed(6) + ", over the " + this.config.dailyUsd + " ceiling"
          ),
          quoted_cost_usdc: offer.amount_usdc
        };
      }
    }

    const paymentClient = x402Client.fromConfig({
      // The x402 client types the network as a CAIP-2 template literal; the
      // configured value is checked against the challenge on every call.
      schemes: [{ network: this.config.network as `${string}:${string}`, client: new ExactEvmScheme(toClientEvmSigner(this.payer)) }]
    });
    // Every 402 seen mid-flight is revalidated, so a challenge that changes
    // between the quote and the retry cannot slip past the allowlist.
    const guarded: typeof fetch = async (input, init) => {
      const response = await this.fetchImpl(input as Parameters<typeof fetch>[0], init);
      if (response.status === 402) validateChallenge(readChallenge(response), this.config);
      return response;
    };

    let response: Response;
    try {
      response = await wrapFetchWithPayment(guarded, paymentClient)(url, {
        method: "POST",
        headers,
        body,
        signal: AbortSignal.timeout(this.config.requestTimeoutMs)
      });
    } catch (error) {
      this.recentFailures += 1;
      if (error instanceof ChallengeRejected) {
        return { ...fail("CHALLENGE_REJECTED", error.message), quoted_cost_usdc: offer.amount_usdc };
      }
      const message = error instanceof Error ? error.message : String(error);
      return { ...fail("PAYMENT_FAILED", message), quoted_cost_usdc: offer.amount_usdc };
    }

    const text = await response.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }

    const paymentEnvelope = decodePaymentResponse(response.headers.get("payment-response"));
    const settlement = findSettlementReference(paymentEnvelope);
    const envelope = paymentEnvelope && typeof paymentEnvelope === "object" ? (paymentEnvelope as Record<string, unknown>) : {};
    const payment = paymentEnvelope
      ? {
          network: typeof envelope.network === "string" ? envelope.network : null,
          payer: typeof envelope.payer === "string" ? envelope.payer : null,
          settlement_transaction: settlement,
          settled: envelope.success === true
        }
      : null;

    if (!response.ok) {
      this.recentFailures += 1;
      return {
        ...fail("ROUTER_HTTP_ERROR", "Telegraph returned HTTP " + response.status),
        quoted_cost_usdc: offer.amount_usdc,
        payment,
        raw_response_hash: hashRaw(parsed)
      };
    }

    const normalized = normalizeResponse(parsed, request.intent);
    // Spend is recorded against what settled, not what was quoted.
    const settledUsd = normalized.reported_cost_usd ?? quotedUsd;
    this.ledger.record(caseEventKey, settledUsd);
    if (this.durable?.configured) await this.durable.add(settledUsd);
    this.recentFailures = 0;
    this.lastSuccess = { at: new Date().toISOString(), miner_id: normalized.miner_id, cost_usd: normalized.reported_cost_usd };

    return {
      ...receipt,
      ...normalized,
      status: "succeeded",
      quoted_cost_usdc: offer.amount_usdc,
      duration_ms: Math.round(performance.now() - startedAt),
      payment,
      raw_response_hash: hashRaw(parsed),
      created_at: new Date().toISOString()
    };
  }
}
