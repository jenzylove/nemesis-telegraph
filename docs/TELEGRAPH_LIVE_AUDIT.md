# Telegraph Live Audit for NEMESIS

**Audit time:** 2026-09-04 20:55–20:58 UTC  
**Scope:** research/feasibility only; no NEMESIS product integration was implemented.  
**Source baseline inspected:** local `jenzylove/nemesis` checkout at `4b2145f` and the PRD's frozen commit `d51a672ae631170609bd3c1f867cb8f5ef10375c`. The intended `nemesis-telegraph` workspace contained no source commit at audit start.

## Executive finding

Telegraph is usable for the Track 3 concept, but the strongest integration is narrower and more defensive than the PRD assumes:

1. Keep JSON-RPC authoritative. `ONCHAIN_TX_LOOKUP` is useful primarily as an independently routed comparison and discrepancy detector, not as a replacement blockchain data path.
2. Use `FRAUD_DETECTION` as the highest-value external-intelligence intent, but persist its result as a miner observation with explicit coverage and caveats. Several miners serve unrelated fraud domains; capability membership alone is not enough to establish wallet compatibility.
3. Use `NEWS_SEARCH` conditionally for named exploits/protocols. Prefer it over generic `WEB_SEARCH`, whose current top-ranked miner is a job-search service and whose scores are extremely small.
4. Defer `WALLET_BALANCE_CHECK`. NEMESIS can obtain authoritative balances over RPC, so the intent adds cost and little new information unless a miner contributes non-RPC context.
5. The documented router says it chooses the top two miners and tries the primary then fallback. That is not the same as the hackathon rules' public claim of probabilistic score-weighted routing. Treat routing behavior as an unresolved protocol discrepancy and capture the actual miner returned on every call.
6. A real paid replay was not performed because no funded burner key was available and payment requires explicit approval. A real live x402 challenge was captured, five challenge probes were stable, and live miner calls were made directly to validate schemas and latency. Direct calls are not presented as Telegraph usage.

## NEMESIS baseline observed in source

The existing system already has the right boundary for Telegraph:

- FastAPI owns case APIs and internal Scheduler/Pub/Sub callbacks.
- `Taskmaster.recheck()` only promotes a dormant branch after the movement provider returns an outgoing movement. The hybrid movement provider verifies indexed Alchemy/Bitquery candidates through JSON-RPC before returning them.
- The lifecycle persists `MOVEMENT_DETECTED`, publishes `TRACE_REQUESTED`, then `resume()` emits `TRACING_RESUMED` and continues deterministic tracing.
- Firestore collections include `cases`, `trace_branches`, `case_graph_nodes`, `case_graph_edges`, `case_timeline`, and `processed_events`.
- Pub/Sub event claiming is idempotent: failures release the claim and completed events are not processed twice.
- Gemini runs through Google ADK after deterministic evidence is saved. Structured output is checked for unsupported evidence references and blockchain identifiers.
- The frontend consumes case, graph, branch, and timeline APIs. No redesign is necessary; a receipt list/detail can be added later.

This makes the correct future insertion point an event after RPC verification and independent of trace success. Telegraph failure must not change branch state or block trace continuation.

## Official current surfaces

The current official API source of truth describes three relevant surfaces:

- `GET /engine/v1/intents`, `/engine/v1/intents/{id}`, and `/engine/v1/intents/{id}/miners`: free discovery.
- `POST /engine/v1/ask`: x402-gated natural-language routing.
- `POST /engine/v1/ask/{miner_id}`: x402-gated direct miner call using `{method, endpoint, payload}`.

The routed request schema is:

```json
{
  "query": "natural-language request",
  "context": { "optional": "JSON object; caller keys win" }
}
```

The documented routed response includes `miner_used`, `miner_name`, optional `endpoint`, free-form `result`, `cost_usd`, `duration_ms`, `timestamp`, optional `reasoning`, and optional `intent`. The direct response uses `miner_id`, `miner_name`, `result`, `cost_usd`, `duration_ms`, and `timestamp`.

Important limitation: neither HTTP inference response schema guarantees `signal_hash`, a validator score, or verification metadata. `signal_hash` appears in the separate ERC-8183 job schemas, while the Explorer displays signal hashes for recent calls. NEMESIS must not manufacture verification fields when the paid HTTP response omits them.

Sources: [official engine OpenAPI](https://github.com/telegraphprotocol/telegraph-api-docs/blob/main/openapi/engine.yaml), [engine HTTP guide](https://github.com/telegraphprotocol/telegraph-api-docs/blob/main/docs/engine-daemon/engine-http.md), [protocol flow](https://github.com/telegraphprotocol/telegraph-docs/blob/main/protocol/how-it-works.md).

## Live registry snapshot

At 2026-09-04 20:55 UTC, `GET http://13.237.89.59:7044/engine/v1/intents` returned HTTP 200 with:

- 45 canonical intents;
- 43 intents with at least one miner;
- `FRAUD_DETECTION`: 15 miners;
- `ONCHAIN_TX_LOOKUP`: 12 miners;
- `WEB_SEARCH`: 10 miners;
- `NEWS_SEARCH`: 5 miners;
- `WALLET_BALANCE_CHECK`: 10 miners.

The live miner catalog contained 129 entries. Its `cost_per_call` field was `0.00` for observed candidates even though the x402 challenge and Explorer showed $0.01. Therefore the catalog cost field is not reliable for spend authorization; use the signed challenge as the authoritative quote.

The registry endpoint succeeded in 5/5 probes. Latencies were 0.922, 0.935, 1.049, 1.252, and 6.138 seconds. The outlier matters for deployment timeouts and caching.

## Latest live leaderboard snapshot

The Explorer was read at epoch 308. Scores below are displayed values, not normalized confidence probabilities.

| Intent | Current leaders observed | Assessment for NEMESIS |
|---|---|---|
| `ONCHAIN_TX_LOOKUP` | #1 DegenLens 0.012; #2 ChainSight 0.011; #3 ChainWire 0.0099; #4 TxLens 0.0095 | Viable, but low absolute scores demand comparison-only semantics. |
| `FRAUD_DETECTION` | #1 Anchor ~1e-13; #2 SarzOps ~5.2e-14; #3 DegenLens ~3.9e-14 | Ranking is currently not a proxy for wallet-fit. Anchor measures Aave counterparty solvency; DegenLens is a closer incident-response fit. |
| `NEWS_SEARCH` | #1 Tavily 1.000; #2 NewsWire 0.00015; others 0 | Strongest current public-context choice; use only with narrow queries. |
| `WEB_SEARCH` | #1 Legwork ~4.5e-10; #2 Tavily ~4.3e-10 | Current #1 is job-search oriented. Generic router selection is risky for incident context. |
| `WALLET_BALANCE_CHECK` | #1 ChainWire ~2.4e-13; #2 ChainSight ~2.3e-13; #3 TxLens ~2.2e-13; #5 DegenLens ~1.8e-13 | Functional, but duplicative of authoritative RPC. |

Explorer source: [live Telegraph leaderboard](https://explorer.telegraphprotocol.com/miners/leaderboard).

## Candidate miner fit and schemas

### DegenLens (`10002`, `degenlens-onchain`)

Best current multi-intent fit for a controlled direct fallback. It was active, had served 1,728 requests, was #1 for transaction lookup, #3 for fraud, and #5 for balance in the observed epoch. Minimum price shown by Explorer: $0.01 USDC.

Relevant live manifest inputs:

- Transaction: `tx_hash` (required), `query` (required), `chain` (optional enum).
- Fraud: `query` (required; should name address/transaction and chain).
- Balance: `address` and `query` (required), `chain` optional.

Declared output fields include `confidence`, `verdict`, `reasoning`, `data_source`; optional transaction facts; optional balance fields; and optional `risk_score`, `risk_tier`, `is_suspicious`, `risk_signals`, and `coverage_complete`.

Observed direct endpoint results:

- Transaction lookup: HTTP 200 in 2.330 s; returned status, block, timestamp, sender, recipient, gas/fee, method selector, ERC-20 transfers, confidence, verdict, reasoning, `data_source: live`, and evidence reference.
- Fraud check: HTTP 200 in 2.871 s; returned five screening measurements, `risk_score: 0.4`, `risk_tier: elevated_risk`, confidence 0.85, coverage flag, and an explicit “not a finding of fraud” caveat.
- Balance check: HTTP 200 in 1.309 s; returned exact wei and decimal balance, block number, attribution metadata, confidence, and source status.

These were direct public miner calls. They prove live miner availability and actual shape only; they do **not** prove Telegraph routing, payment, settlement, or counted Track 3 usage.

### Other useful candidates

- Transaction fallback pool: ChainSight (`302`), ChainWire (`7307`), TxLens (`9002`), OnChain Intel (`900`), Sigil (`9010`). Sigil advertises dual-RPC agreement; it was #10 with score 0 in the observed epoch, so validate before selection.
- Fraud: Telegraph Sentinel (`94217603`) and DegenLens describe wallet-focused checks. Anchor (`49`) is #1 but measures Aave solvency/counterparty risk and is not a general theft-address fraud oracle. SarzOps focuses sourced fraud knowledge rather than necessarily wallet telemetry.
- News: Tavily (`202`) is the clear observed leader and declares synthesized answers plus source URLs. NewsWire (`7329`) is a keyless Google News RSS/Hacker News alternative.
- Balance: ChainWire (`7303`) and DegenLens are schema-compatible. Prefer NEMESIS RPC instead unless the extra context is explicitly needed.

## Routing behavior and reliability

Documented engine behavior is deterministic top-two selection with one fallback: classify intent, select the two highest-ranked miners, try primary, then fallback. The hackathon rules instead describe probabilistic routing based on intent, confidence threshold, deadline, and score. The public `AskRequest` currently exposes only `query` and `context`; it has no explicit confidence-threshold or deadline fields.

This conflict must be clarified with Telegraph before claiming probabilistic behavior in the product or demo. Record `routing_mode`, requested intent, detected intent, selected miner, and any fallback/error on every call.

Five real unpaid `/engine/v1/ask` probes all returned a valid HTTP 402 challenge in 0.864–0.973 s. This establishes reachability and stable challenge generation, not post-payment routing reliability. A paid replay remains required to measure route selection, inference latency, response shape, and settlement headers.

## x402 live evidence

The real challenge received from `POST /engine/v1/ask` was x402 v2 in a `Payment-Required` header and body. It offered two `exact` choices:

| Network | Asset | Atomic amount | Human amount | Payee |
|---|---|---:|---:|---|
| Base Sepolia (`eip155:84532`) | USDC `0x036CbD53842c5426634e7929541eC2318f3dCF7e` | 10,000 | 0.01 USDC | `0x5a2324aA18613FAD4e44bDF0d6c73Ec1f6D87ff8` |
| Solana devnet (`solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1`) | asset `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPPJgZJDncDU` | 10,000 | 0.01 USDC | `G53EbeTZSNsAn7bj6iMFUQnq3zpDdEbHhKkPRywo8bix` |

The challenge allowed 60 seconds and described the resource as LLM-routed inference. This differs from older prose in official docs that calls the scheme `x402`, uses older network names, and labels the production protocol “v1.” The actual live v2 challenge is authoritative for implementation.

The official TypeScript MCP implementation uses `@x402/fetch`, `@x402/evm`, `@x402/svm`, `viem`, and local private-key custody. It automatically signs and retries. Source: [official Telegraph MCP](https://github.com/telegraphprotocol/telegraph-mcp), [official x402 v2 specification](https://github.com/x402-foundation/x402/blob/main/specs/x402-specification-v2.md).

No payment was submitted. A paid smoke call requires explicit approval for a selected network and a burner wallet holding the matching testnet USDC. The response must then be captured with `PAYMENT-RESPONSE`, transaction/settlement reference, selected miner, returned intent, cost, latency, and any signal hash.

## Track 3 rules verified

Current official rules state:

- Track 3 runs Aug 31–Sep 7, 2026 and closes Sep 7 at 23:59 UTC.
- Apps must use real miners; mocks are not acceptable.
- Artificial metric inflation is disqualifying.
- Public X updates must tag `@Telegraphprotoc`.
- Joining and monitoring the official Discord is required.
- The public judging page emphasizes users/activity, adoption, usefulness, real miners, and public engagement.

Source: [official hackathon rules](https://hackathon.telegraphprotocol.com/rules).

## Recommended intent set

| Intent | Decision | Trigger | Why |
|---|---|---|---|
| `FRAUD_DETECTION` | Keep, core | Significant new destination; dormant movement destination; explicit analyst request | Adds non-RPC behavioral/risk context. Must use wallet-compatible miners and caveated semantics. |
| `ONCHAIN_TX_LOOKUP` | Keep, secondary core | Verified theft transaction and verified resumed movement | Independent comparison, discrepancy detection, and visible Track 3 evidence. Never overwrite RPC. |
| `NEWS_SEARCH` | Keep, conditional | Named exploit/protocol/entity plus narrow time/topic query | Current Tavily leaderboard signal is much stronger than generic web search. |
| `WEB_SEARCH` | Defer/fallback only | Only if news is insufficient and direct miner compatibility is confirmed | Current top rank is domain-misaligned; routing semantics are uncertain. |
| `WALLET_BALANCE_CHECK` | Defer | Optional explicit analyst snapshot | RPC already provides the authoritative fact; avoid paying for duplicated evidence. |

## Fallback strategy

1. Query/cache live intent and miner data with a short TTL; keep the last known good snapshot with its timestamp.
2. Use routed `/v1/ask` first to participate in Telegraph's quality flywheel.
3. Validate that detected intent matches requested intent and that the selected miner's current manifest supports the target domain/chain.
4. On router timeout, misrouting, schema incompatibility, or all-miner failure, select a current active compatible miner from the live leaderboard and call `/v1/ask/{miner_id}`.
5. Record `direct_fallback`, reason, registry/leaderboard epoch, miner ID/slug, and challenge quote. Do not silently label it routed.
6. Cap at one paid fallback per logical receipt/idempotency key. If both fail, persist a failed receipt and continue the NEMESIS trace.

## Documented vs observed vs unresolved

| Topic | Documented | Observed live | Status |
|---|---|---|---|
| Router | Top-two primary/fallback in OpenAPI; probabilistic in rules | Paid route not observed | Must clarify and paid-test |
| Cost | Typical/minimum $0.01 | Challenge and Explorer $0.01; catalog `0.00` | Trust challenge, not catalog |
| Payment version | Some official prose says production v1 | x402 v2 challenge | Implement v2; avoid stale examples |
| Networks | Docs list Base, Base Sepolia, Polygon, Solana devnet | Challenge offered Base Sepolia and Solana devnet | Fund one offered testnet path |
| Signal proof | Explorer/protocol discuss signal hashes | HTTP schema does not guarantee them | Persist only returned metadata |
| Miner schemas | Public YAML manifests | DegenLens schema and outputs matched materially | Validate per selected miner |
| Router availability | Public node documented | 5/5 stable 402 challenges | Post-payment reliability unknown |
| Registry availability | Free endpoint documented | 5/5 success; one 6.1 s outlier | Cache and use timeouts |

## Credentials and funding required

- A dedicated burner private key stored in Secret Manager, never frontend or repository.
- Either Base Sepolia USDC at `0x036CbD53842c5426634e7929541eC2318f3dCF7e` plus enough Base Sepolia ETH for any required gas, or the exact Solana devnet asset offered by the challenge plus SOL if required by the client/facilitator.
- Budget for at least three controlled $0.01 calls: routed transaction, routed fraud, and one direct-fallback verification. Use a low wallet balance and explicit per-call/per-case/daily ceilings.
- Telegraph Discord/registration access for current submission and routing clarification.

## Blockers

1. No paid, settled Telegraph response yet; only a genuine challenge and direct-miner results.
2. Router's real post-payment selection/fallback behavior remains unmeasured.
3. Official sources disagree on x402 version terminology, header examples, and routing semantics.
4. Catalog cost is inconsistent with the actual challenge.
5. HTTP inference does not contractually guarantee signal/verification fields.
6. The target `nemesis-telegraph` source repository was not present in this workspace at audit start.

