# Telegraph Integration Ledger

**As of:** 2026-09-05  
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
| TypeScript gateway architecture | Isolate payer/runtime risk | Yes | Locally tested | Built at `gateway/`. Quote, allowlist, spend authorization, payment, settlement and normalization proven in one path by a real settled FRAUD_DETECTION call. 44 gateway tests. |
| Secret Manager burner key | Keep payer key out of API/frontend | Yes | Locally tested | Funded Base Sepolia burner `0x8827d3AF...2324` configured locally through a gitignored `.env.local`, never printed or committed. Secret Manager wiring still required for Cloud Run deployment. |
| Per-call/per-case/daily budgets | Prevent uncontrolled spend | Yes | Locally tested | Enforced before signing. Only settled spend counts, so a failed call frees its budget. Daily total rolls at UTC midnight. |
| Controlled payment concurrency | Avoid nonce/settlement races | Yes | Locally tested | Serial queue proven to hold peak concurrency at 1, and a rejected payment does not wedge it. Cloud Run max-instances is pinned to 1 so serialization stays meaningful. |
| Routed-first/direct-fallback policy | Preserve quality flywheel and reliability | Yes | Locally tested | Routed first; direct fallback only on router HTTP error, timeout, unreachability, or intent mismatch, capped at one paid fallback. Direct fallback has not yet been exercised against the live router. |
| Direct DegenLens transaction call | Validate live miner schema | Research | Locally tested | HTTP 200, 2.330 s, detailed transaction/RPC fields. Not Telegraph usage. |
| Direct DegenLens fraud call | Validate wallet risk semantics | Research | Locally tested | HTTP 200, 2.871 s, risk 0.4/elevated, five screens, explicit non-guilt caveat. Not Telegraph usage. |
| Direct DegenLens balance call | Validate optional schema | Research | Locally tested | HTTP 200, 1.309 s, exact wei/block/attribution fields. Not Telegraph usage. |
| `FRAUD_DETECTION` | Destination external risk context | Candidate Core | Planned | Keep. 15 miners live; use wallet-compatible miner and preserve caveats/coverage. |
| `ONCHAIN_TX_LOOKUP` | Independent comparison for verified tx | Candidate Core | Planned | Keep. 12 miners live; DegenLens currently #1. RPC remains authoritative. |
| `NEWS_SEARCH` | Narrow current incident context | Conditional | Planned | Keep conditionally. Five miners; Tavily currently #1 at 1.000. |
| `WEB_SEARCH` | General external context | Optional | Deferred by explicit decision | Unchanged. Current top-ranked miner is domain-misaligned. |
| `WALLET_BALANCE_CHECK` | Current destination balance | Optional | Deferred by explicit decision | Duplicates authoritative RPC and adds payment; reconsider only for unique context. |
| Telegraph receipt persistence | Durable proof and audit | Yes | Locally tested | Top-level `telegraph_receipts`, FastAPI owns writes, receipt id derived from case, branch, event, intent, chain and target. Firestore create() is the claim primitive. |
| Receipt/timeline linkage | Visible autonomous intelligence | Yes | Locally tested | TELEGRAPH_ENRICHMENT_REQUESTED, TELEGRAPH_INTELLIGENCE_RECEIVED and TELEGRAPH_ENRICHMENT_FAILED carry the receipt id and a compact label, never the payload. |
| Payment idempotency | Prevent duplicate Pub/Sub charges | Yes | Locally tested | Guarded twice: the Pub/Sub event claim, and the receipt claim taken before the gateway is called. Tested that a redelivery under a new event id still cannot pay twice. |
| Initial verified-tx enrichment | Real case-event integration | Yes | Locally tested | Fires from trace_initial under trigger VERIFIED_INCIDENT, after RPC verification, as published events rather than awaited calls. |
| `MOVEMENT_DETECTED` re-enrichment | Flagship autonomy | Yes | Locally tested | Fires from resume() after the movement is RPC-verified and destinations normalized. Tested end to end: quiet recheck spends nothing, verified movement enriches, gateway outage leaves branch state untouched. |
| Gemini boundary | Prevent external guesses becoming facts | Yes | Planned | Receipts are served on a separate API plane marked non-authoritative. Feeding them to Gemini as bounded context is not yet wired. |
| UI Telegraph evidence plane | Judge/user comprehension | Yes | Locally tested | New Telegraph section plus an overview panel. Amber styling separates external opinion from verified fact, failures and disagreements are shown, and proof links appear only where Telegraph returned proof. |
| Registry cache/last-known-good snapshot | Tolerate latency/outage | Yes | Locally tested | Five minute TTL with a last known good snapshot; a registry outage after one success still yields a fallback candidate. |
| Paid end-to-end demo | Track 3 proof | Yes | Blocked | Depends on gateway paid spike, target repo, deployment, and funded burner. |
| Official Discord/submission recheck | Operational rule changes | Yes | Credential needed | User/account access required; rules say Discord participation is mandatory. |

## Explicitly not implemented in this pass

- No production Telegraph adapter or gateway.
- No changes to FastAPI, tracing, Firestore models, Pub/Sub, Scheduler, Gemini/ADK, or frontend.
- No wallet secret creation, funding, signing, or payment.
- No mocked miner response presented as evidence.
- No deployment or full integration.


## Added during implementation

| Integration / Capability | Why | Required? | Status | Evidence / Blocker |
|---|---|---:|---|---|
| Gateway internal auth | The gateway spends money | Yes | Locally tested | Constant-time bearer check. Missing and wrong tokens both answer 401; the enrich route is unreachable without it. Cloud Run deploys it with no-allow-unauthenticated. |
| Intent mismatch handling | An answer to another question is not the answer | Yes | Locally tested | A mismatch fails the receipt rather than presenting it as the requested intelligence, and is the one non-error condition that justifies a paid fallback. |
| RPC discrepancy capture | Keep RPC authoritative without hiding conflict | Yes | Locally tested | A miner contradicting verified facts has the clash persisted with authoritative json_rpc, surfaced in the UI, and counted in the case summary. |
| Absent-signal semantics | Silence must never read as safety | Yes | Locally tested | A verdict of RECHECK, unknown, or no data normalizes to NO_EXTERNAL_SIGNAL, and incomplete coverage is stated in the UI. Driven by the real SarzOps reply. |
| Dust and depth guards | Do not pay to enrich noise | Yes | Locally tested | Dust amounts and branches past depth four are skipped before an event is published. |
| Separate Cloud Run services | Protect the submitted deployment | Yes | Planned | cloudbuild.telegraph.yaml, cloudbuild.gateway.yaml and cloudbuild.telegraph-frontend.yaml target nemesis-telegraph-* only. The originals are unmodified and still deploy nemesis-api-staging and nemesis-web. Not yet deployed. |
| Public read-only receipts | Track 3 visible usage | Yes | Locally tested | The public telegraph endpoint serves receipts only for published cases; an unpublished case 404s exactly as a missing one does. |
| Direct fallback paid proof | Prove the fallback path | Desired | Blocked | Implemented and unit tested, but never exercised against the live router. Needs a routed failure to occur or a deliberate paid test. |
| Deployment and live E2E | Track 3 submission | Yes | Blocked | Needs Secret Manager entries, the nemesis-telegraph service account, and deployment. |

## After the live end-to-end run (2026-09-05)

| Integration / Capability | Status | Evidence |
|---|---|---|
| Autonomous loop, end to end, paid | Locally tested | Dormant recheck, RPC-verified movement, trace resume, published enrichment, one settled routed call, persisted receipt, timeline update. No human step in the loop. `docs/evidence/telegraph-e2e-2026-09-05.json`. |
| Spend ceiling under real conditions | Locally tested | The per-case-event ceiling was set to one cent for the run. The second intent was refused before signing and persisted as a visible failed receipt. |
| Trace independence from Telegraph | Locally tested | Branch state after the run was decided by RPC-verified tracing alone; neither the paid answer nor the refusal changed it. |
| Router miner unpredictability | Production verified | Three settled calls returned three different miners: ChainSight (302), SarzOps (91001), INTERLOCK. None matched the rank observed at audit time. |
| Deploy to Cloud Run | Blocked | Needs approval to deploy into project `nemesis-506114` alongside the submitted services, plus Secret Manager entries and a service account. |
| Deployed live E2E | Blocked | Depends on deployment and on spend beyond the approved 0.03 test USDC. |
| Direct fallback paid proof | Blocked | Implemented and unit tested; the live router has not failed in any of the three paid calls, so the path is still unexercised against production. |
| Discord, submission form, X posts | Blocked | Needs account access. |
| Demo video | Blocked | Follows deployment. |

**Cumulative real spend: 0.03 test USDC across three settled calls, each verified on Base Sepolia.**
