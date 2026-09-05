# Telegraph Integration Ledger

**As of:** 2026-09-04  
**Audit rule:** “Locally tested” means a real live observation, not a mock. Direct miner calls are explicitly distinguished from paid Telegraph calls.

| Integration / Capability | Why | Required? | Status | Evidence / Blocker |
|---|---|---:|---|---|
| Protect frozen NEMESIS source | Preserve prior submission | Yes | Locally tested | PRD commit `d51a672...` inspected in disposable checkout; local current source also inspected at `4b2145f`. No source change made. |
| `nemesis-telegraph` target repository | Separate Track 3 history/deployments | Yes | Blocked | Current target workspace had an empty Git repository and no source commit. Fork/copy must occur in implementation milestone, not this audit. |
| Live intent registry | Dynamic discovery | Yes | Locally tested | HTTP 200; 45 canonical intents, 43 with miners; 5/5 probe success; 0.92–6.14 s. |
| Live miner catalog | Compatibility discovery | Yes | Locally tested | HTTP 200; 129 miners observed. Catalog cost fields were inconsistent with challenge price. |
| Live leaderboard | Quality/rank input | Yes | Locally tested | Explorer epoch 308 inspected for all candidate intents. Scores and ranks recorded in live audit. |
| Miner manifest/schema retrieval | Safe request adaptation | Yes | Locally tested | Full DegenLens YAML inspected; request/output schema and endpoint mappings recorded. |
| Router x402 challenge | Establish real payment terms | Yes | Locally tested | 5/5 real `/engine/v1/ask` probes returned 402 in 0.864–0.973 s; v2 offered Base Sepolia or Solana devnet, 0.01 USDC. |
| Settled x402 payment | Prove paid Telegraph usage | Yes | Production verified | Settled 2026-09-05. Base Sepolia tx `0x869b4b7c...fc6e`, receipt success, block 46413496. Exactly one USDC log: 0.01 from payer to the expected Telegraph payee. Payer balance 20 to 19.99. |
| Routed miner response | Validate selected miner, intent, result, latency | Yes | Production verified | HTTP 200. Miner `302` ChainSight. Returned intent matched requested. Reported cost 0.01, miner duration 1046 ms, end to end 8872 ms. Result agreed with NEMESIS RPC. |
| Router probabilistic behavior | Support quality-flywheel claim | Track 3 important | Blocked | One settled call returned the observed rank two miner, not rank one, with no fallback field. Evidence against deterministic rank one selection, but one sample cannot prove a distribution. Do not claim probabilistic routing in the product. |
| Payment receipt metadata | Audit spend/settlement | Yes | Production verified | Real `PAYMENT-RESPONSE` captured and decoded: success, payer, settlement transaction, network. Settlement independently reverified against Base Sepolia rather than trusted. |
| Signal hash / verification metadata | Proof in UI/audit | Desired | Production verified | `signal_hash` `0x273ba7a9...5bc0` was returned at the top level of the paid response. Still not contractually guaranteed: persist when returned, never synthesize. No `verification` object was returned, so Explorer linkage remains unconfirmed. |
| TypeScript gateway architecture | Isolate payer/runtime risk | Yes | Planned | Recommended decision documented; no product code created. |
| Secret Manager burner key | Keep payer key out of API/frontend | Yes | Locally tested | Funded Base Sepolia burner `0x8827d3AF...2324` configured locally through a gitignored `.env.local`, never printed or committed. Secret Manager wiring still required for Cloud Run deployment. |
| Per-call/per-case/daily budgets | Prevent uncontrolled spend | Yes | Planned | Enforce challenge allowlist and deterministic idempotency before paid integration. |
| Controlled payment concurrency | Avoid nonce/settlement races | Yes | Planned | Start at concurrency 1; test before raising. |
| Routed-first/direct-fallback policy | Preserve quality flywheel and reliability | Yes | Planned | Direct fallback only on observable failure/mismatch, using current compatible miner. |
| Direct DegenLens transaction call | Validate live miner schema | Research | Locally tested | HTTP 200, 2.330 s, detailed transaction/RPC fields. Not Telegraph usage. |
| Direct DegenLens fraud call | Validate wallet risk semantics | Research | Locally tested | HTTP 200, 2.871 s, risk 0.4/elevated, five screens, explicit non-guilt caveat. Not Telegraph usage. |
| Direct DegenLens balance call | Validate optional schema | Research | Locally tested | HTTP 200, 1.309 s, exact wei/block/attribution fields. Not Telegraph usage. |
| `FRAUD_DETECTION` | Destination external risk context | Candidate Core | Planned | Keep. 15 miners live; use wallet-compatible miner and preserve caveats/coverage. |
| `ONCHAIN_TX_LOOKUP` | Independent comparison for verified tx | Candidate Core | Planned | Keep. 12 miners live; DegenLens currently #1. RPC remains authoritative. |
| `NEWS_SEARCH` | Narrow current incident context | Conditional | Planned | Keep conditionally. Five miners; Tavily currently #1 at 1.000. |
| `WEB_SEARCH` | General external context | Optional | Deferred by explicit decision | Current ranking/domain alignment is weak; use only as fallback after proof. |
| `WALLET_BALANCE_CHECK` | Current destination balance | Optional | Deferred by explicit decision | Duplicates authoritative RPC and adds payment; reconsider only for unique context. |
| Telegraph receipt persistence | Durable proof and audit | Yes | Planned | Proposed top-level `telegraph_receipts` keyed deterministically; FastAPI owns writes. |
| Receipt/timeline linkage | Visible autonomous intelligence | Yes | Planned | Timeline stores receipt reference and compact status, not raw result. |
| Payment idempotency | Prevent duplicate Pub/Sub charges | Yes | Planned | Key from case/branch/event/intent/chain/target; claim before gateway call. |
| Initial verified-tx enrichment | Real case-event integration | Yes | Planned | Must be async and occur only after RPC verification. |
| `MOVEMENT_DETECTED` re-enrichment | Flagship autonomy | Yes | Planned | Publish after RPC-confirmed movement and target normalization; tracing remains independent. |
| Gemini boundary | Prevent external guesses becoming facts | Yes | Planned | Existing evidence-reference guards should be extended with separately labeled Telegraph receipts. |
| UI Telegraph evidence plane | Judge/user comprehension | Yes | Planned | Add receipt list/detail later; no redesign. |
| Registry cache/last-known-good snapshot | Tolerate latency/outage | Yes | Planned | One observed 6.138 s registry response supports short TTL and timeout policy. |
| Paid end-to-end demo | Track 3 proof | Yes | Blocked | Depends on gateway paid spike, target repo, deployment, and funded burner. |
| Official Discord/submission recheck | Operational rule changes | Yes | Credential needed | User/account access required; rules say Discord participation is mandatory. |

## Explicitly not implemented in this pass

- No production Telegraph adapter or gateway.
- No changes to FastAPI, tracing, Firestore models, Pub/Sub, Scheduler, Gemini/ADK, or frontend.
- No wallet secret creation, funding, signing, or payment.
- No mocked miner response presented as evidence.
- No deployment or full integration.

