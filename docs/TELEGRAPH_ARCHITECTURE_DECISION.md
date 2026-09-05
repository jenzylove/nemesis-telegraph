# Architecture Decision: NEMESIS × Telegraph

**Status:** Proposed after live feasibility audit  
**Date:** 2026-09-04  
**Decision scope:** integration architecture only; implementation has not begun.

## Decision

Build a small isolated Node/TypeScript Telegraph gateway on a new Cloud Run service. Keep case-event policy, deterministic RPC verification, trace lifecycle, Firestore ownership, and timeline semantics in the existing Python/FastAPI service.

Use Telegraph's routed `POST /engine/v1/ask` by default and the paid direct `POST /engine/v1/ask/{miner_id}` endpoint only as an observable fallback based on the live registry/leaderboard and compatible manifest.

This is the lowest-risk path to ship before Sep 7 because Telegraph's maintained consumer implementation and x402 v2 dependencies are TypeScript-first, while NEMESIS's evidence and lifecycle code can remain untouched except for a narrow asynchronous client boundary.

## Required evidence boundary

```text
DORMANT branch
  → movement detector proposes candidate
  → JSON-RPC verifies the movement
  → MOVEMENT_DETECTED persists
  → TRACE_REQUESTED resumes deterministic tracing
  → TELEGRAPH_ENRICH_REQUESTED is published idempotently
  → TypeScript gateway routes/pays/calls
  → FastAPI validates and persists external receipt
  → timeline references receipt
  → frontend renders Onchain / Telegraph / Agent separately
```

Telegraph may add context or flag a disagreement. It cannot change transaction existence, sender, recipient, amount, block, graph edge, branch state, or movement status.

## Options compared

| Option | Advantages | Risks / cost | Sep 7 assessment |
|---|---|---|---|
| Python adapter inside existing FastAPI | One deployment; direct access to existing repository and Firestore; simplest synchronous call graph | No official maintained Python consumer was found for the live x402 v2 flow; key/payment dependencies would enter the critical API runtime; payment retries/concurrency could destabilize trace processing; stale official Python examples manually describe payment | Viable only if a paid Python spike is proven immediately. Not recommended. |
| Isolated Node/TypeScript gateway | Reuses official `@x402/fetch` 2.11, EVM/SVM schemes, and `viem`; contains payer key and dependency churn; independently deployable/rollbackable; strong failure boundary | Adds one service and authenticated internal API; Firestore write ownership must remain clear; requires Cloud Run/Secret Manager wiring | **Recommended.** Best balance of proof, isolation, and schedule. |
| Run the official Telegraph MCP server as a subprocess/sidecar and call it from Python | Minimal payment code; official tools expose routed and direct asks | MCP process supervision and JSON-RPC framing add operational complexity; tool responses are text envelopes; difficult idempotency/spend enforcement; not designed as a durable multi-tenant payment service | Useful for local paid spike only; not the product architecture. |
| Call selected miner directly | Simplest HTTP and easiest schema control | Bypasses Telegraph routing/payment/verification and does not satisfy Track 3 integration evidence | Not viable as primary integration. Only the Telegraph paid direct endpoint is an acceptable fallback. |
| WebSocket signal subscription | Persistent intelligence and protocol-native stream | Requires EIP-191 verification, ≥$1 escrow floor, new lifecycle, and has no need for the flagship event-driven flow | Defer. Too much new surface for this deadline. |

## Gateway boundary

The gateway should expose a tiny authenticated internal contract, not a generic miner browser:

```json
POST /internal/telegraph/enrich
{
  "idempotency_key": "case:branch:event:intent:target",
  "case_id": "...",
  "branch_id": "...",
  "trigger": "MOVEMENT_DETECTED",
  "intent": "FRAUD_DETECTION",
  "target": { "chain": "ethereum", "address": "0x..." },
  "query": "Assess observable fraud-risk signals for ...; do not infer identity."
}
```

It should return a transport receipt containing only observed values:

```json
{
  "status": "succeeded",
  "routing_mode": "routed",
  "requested_intent": "FRAUD_DETECTION",
  "returned_intent": "FRAUD_DETECTION",
  "miner_id": "10002",
  "miner_slug": "degenlens-onchain",
  "result": {},
  "quoted_cost_usdc": "0.01",
  "reported_cost_usd": 0.01,
  "duration_ms": 0,
  "payment_response": {},
  "signal_hash": null,
  "registry_observed_at": "...",
  "created_at": "..."
}
```

No `verified: true`, signal hash, rank, confidence, or payment transaction should be synthesized when absent.

## Ownership split

### Python/FastAPI owns

- eligibility/trigger rules after deterministic RPC verification;
- case, branch, graph, and timeline linkage;
- Pub/Sub event publication and event-claim idempotency;
- semantic validation against requested target/intent;
- Firestore receipt persistence;
- Gemini inputs and the evidence-plane boundary;
- UI-facing APIs.

### TypeScript gateway owns

- live registry/intent/miner discovery and short-TTL cache;
- x402 v2 challenge interpretation and signing through official packages;
- payer key custody;
- routed request, controlled direct fallback, timeout, and error taxonomy;
- per-call, per-case, and daily spend authorization;
- serialization or bounded concurrency for payments;
- raw response hashing and payment-response capture;
- health metrics without secret exposure.

## Event ordering

For the flagship flow, publish enrichment only after the new movement has been independently verified. The safest minimal wiring is a second Pub/Sub event from `recheck()` after `MOVEMENT_DETECTED` is persisted, or from `resume()` after the specific transaction is normalized. Prefer the latter if the destination address is not known at recheck time.

Use separate events per intent so failure and retry are independently visible:

- `TELEGRAPH_TX_ENRICH_REQUESTED`
- `TELEGRAPH_RISK_ENRICH_REQUESTED`
- `TELEGRAPH_NEWS_ENRICH_REQUESTED` only when a narrow public-context trigger exists.

Derive the payment idempotency key deterministically from `case_id`, `branch_id`, trigger event ID, intent, chain, and target. Claim it before invoking the gateway. Retries must read the existing receipt state and must not pay again after a terminal success.

## Routing policy

1. Default to `/engine/v1/ask` because Track 3 tests the ranked demand flywheel.
2. Set an explicit requested intent inside context, but do not assume the current router honors it; verify `returned_intent`.
3. Reject/mismatch-mark a result if its subject does not match the verified target.
4. Direct fallback is permitted only for timeout, all-miner failure, intent mismatch, or incompatible output.
5. Select fallback from current active miners with compatible manifest inputs and chain coverage. Record leaderboard epoch/rank and reason.
6. One paid fallback maximum per logical request during the initial release.

Current preferred fallback candidates:

- Transaction: DegenLens, then ChainWire/ChainSight after a paid compatibility spike.
- Fraud: DegenLens or Telegraph Sentinel; do not choose Anchor merely because it ranks first when the question is theft-address behavior rather than Aave solvency.
- News: Tavily, then NewsWire.
- Balance: no Telegraph request by default; use NEMESIS RPC.

## Spend and secret controls

- Dedicated burner wallet only.
- Secret Manager-mounted environment secret in the gateway only.
- Start with Base Sepolia because the live challenge offered it and the official EVM packages are small relative to dual-chain support.
- Reject a challenge whose network, asset, amount, or payee falls outside configuration.
- Initial ceilings: $0.01 per call, $0.03 per case event, and a deliberately small daily limit set from demo volume.
- Queue payment execution at concurrency 1 until real parallel settlement behavior is tested.
- Log challenge amount/network/payee hash, not the private key or complete signed authorization.

## Firestore decision

Keep Firestore writes in FastAPI. Use a top-level `telegraph_receipts` collection keyed by deterministic receipt ID, matching the existing top-level `case_timeline`/`trace_branches` repository style. Query by `case_id` and optionally `branch_id`. This is more repository-consistent than introducing subcollections during a deadline spike.

Minimum fields:

- identifiers: receipt ID, idempotency key, case/branch/event;
- evidence boundary: target type/value/chain and RPC evidence reference;
- routing: requested/returned intent, mode, fallback reason, miner ID/slug, registry timestamp/epoch;
- payment: challenge network/asset/amount, reported cost, payment response/reference if returned;
- result: raw response, normalized label/confidence/risk only if present, raw-response hash;
- operation: status, attempts, timestamps, latency, normalized error;
- proof: signal hash/verification metadata only if returned.

Timeline entries should contain receipt ID, intent, miner, routing mode, status, and a compact label. They should not duplicate raw payloads.

## Failure semantics

- Gateway timeout/payment failure/router failure → failed Telegraph receipt; trace continues.
- Intent mismatch → persist mismatch; do not present as requested intelligence.
- Miner response contradicts RPC → persist discrepancy; RPC remains authoritative.
- Fraud result absent/low-confidence → unknown, never “safe.”
- Duplicate Pub/Sub delivery → existing receipt returned; no second payment.
- Registry unavailable → use a recent last-known-good snapshot for direct fallback only if within TTL; otherwise fail enrichment safely.

## Why this changes the PRD

- The router's public implementation contract is top-two fallback, not demonstrably probabilistic routing.
- The live payment is x402 v2 and testnet-based; some official prose/examples are stale.
- Signal hash and verification metadata are not guaranteed in synchronous HTTP response schemas.
- Catalog prices are currently inconsistent with challenges.
- `WALLET_BALANCE_CHECK` does not materially improve NEMESIS's core flow.
- `NEWS_SEARCH` is presently more defensible than generic `WEB_SEARCH`.
- Miner rank must be combined with domain/schema compatibility, especially for `FRAUD_DETECTION`.

## Exact next implementation milestone

**Milestone 1A: one settled gateway spike, then stop and review.**

1. Create a standalone TypeScript spike using the official x402 client packages.
2. Configure one low-balance Base Sepolia burner in Secret Manager.
3. Execute one routed `ONCHAIN_TX_LOOKUP` against an already RPC-verified transaction.
4. Capture the payment response, settlement transaction/reference, selected miner, returned intent, raw result, reported cost, end-to-end latency, and signal hash if present.
5. Repeat once only if needed to exercise direct fallback.
6. Update the live audit and freeze the gateway response contract before touching NEMESIS lifecycle code.

No full integration should begin until this milestone proves paid replay and settles the router/receipt unknowns.

