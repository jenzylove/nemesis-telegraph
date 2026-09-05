# NEMESIS × Telegraph — Track 3 Product Requirements Document

**Status:** Build-ready draft v1.0  
**Target:** Telegraph Hackathon Season I — Track 3 (Applications)  
**Deadline:** September 7, 2026, 23:59 UTC  
**Source Product:** NEMESIS autonomous crypto incident-response system  
**Source Repository:** `jenzylove/nemesis`  
**Frozen Source Commit:** `d51a672ae631170609bd3c1f867cb8f5ef10375c`  
**New Repository:** `jenzylove/nemesis-telegraph`  
**Product Brand:** NEMESIS  
**Build Agent:** Claude Code recommended

---

## 1. Why This Repository Exists

The original `jenzylove/nemesis` repository has already been submitted elsewhere and must remain frozen for judging.

The Telegraph version must therefore be developed in a separate repository.

The new repository should preserve the original NEMESIS history and clearly disclose the fork point:

> NEMESIS × Telegraph is a continuation of the frozen NEMESIS build from commit `d51a672...`, created specifically for Telegraph Hackathon Track 3.

Do not modify, force-push, redeploy over, or otherwise disturb the submitted original repository or its existing production URLs.

---

## 2. Existing Product Baseline

NEMESIS is already a functioning autonomous crypto incident-response application.

Current capabilities include:

- wallet-first incident discovery
- direct investigation from a known theft transaction
- Ethereum and Base support
- deterministic JSON-RPC transaction verification
- multi-hop stolen-fund tracing
- split branch persistence
- deterministic swap continuation
- supported bridge continuation
- persistent case graph and timeline
- dormant branch monitoring
- autonomous movement detection and trace resume
- Firestore persistence
- Google Cloud Pub/Sub
- Google Cloud Scheduler
- Google ADK
- Gemini 3.5 Flash on Vertex AI
- Alchemy historical wallet discovery
- Bitquery realtime movement signals when configured
- GoPlus risk enrichment
- Chainabuse public-report context
- explicit evidence and attribution safety boundaries

The Telegraph build MUST preserve these existing capabilities unless a change is necessary to maintain correctness or reliability.

This is an integration and product-extension project, not a rewrite.

---

## 3. Product Thesis

NEMESIS already answers:

> What deterministically happened onchain, where did the stolen funds move, and when should the investigation resume?

Telegraph should allow NEMESIS to additionally answer:

> What does a live network of ranked external intelligence providers know about the transactions, addresses, and public context surrounding this incident?

The integration therefore creates two clearly separated evidence planes.

### A. Deterministic Onchain Evidence

Owned by NEMESIS and independent RPC verification.

Includes:

- transaction existence
- receipt status
- block timestamp
- token transfer logs
- native transfers
- amounts
- sender and recipient addresses
- trace graph
- branch state
- movement detection
- deterministic swap/bridge evidence

Telegraph MUST NOT replace this layer.

### B. Telegraph Intelligence

Paid, routed, external intelligence returned by real Telegraph Miners.

May include:

- transaction-level external intelligence
- wallet/address fraud or risk intelligence
- current public incident context
- relevant public web/news evidence
- optional current wallet state where useful

Telegraph intelligence may influence:

- investigative priority
- risk context
- escalation quality
- analyst-facing explanation
- which branch deserves additional attention

It may NOT create or overwrite deterministic blockchain facts.

---

## 4. Track 3 Non-Negotiables

The build must follow the latest Telegraph Hackathon rules.

At minimum:

- Track 3 must use REAL Telegraph Miners.
- Simulated or mocked Telegraph Miner responses are not acceptable as evidence of integration.
- Real Telegraph calls must be observable in the deployed product.
- Artificial request inflation is prohibited.
- Telegraph usage should exist because the product needs the intelligence, not merely to generate traffic.
- Public build/judging updates should be prepared for X using required organizer tagging.
- Official Discord should be checked for operational submission updates.
- Submission-form requirements must be re-verified before final submission.

The implementation agent must re-check the latest official rules and public Telegraph documentation before implementation and again before submission.

---

## 5. Core Product Promise

> NEMESIS autonomously investigates stolen-fund incidents using deterministic blockchain evidence, then uses Telegraph’s live ranked intelligence network to assess important transactions, destinations, and public context as the trace evolves — including automatically when dormant funds begin moving again.

Supporting architecture line:

> RPC tells NEMESIS what happened. Telegraph adds external machine intelligence around what happened. NEMESIS decides what deserves attention and keeps watching.

---

## 6. Integration Philosophy

This project MUST NOT become:

- “NEMESIS with a Telegraph button”
- a Telegraph dashboard bolted onto the current UI
- a generic miner browser
- a miner-call demo detached from real investigations
- a replacement for JSON-RPC
- a replacement for GoPlus or Chainabuse solely for sponsor visibility
- a workflow that calls miners on every graph node
- a system that hard-codes one miner because it worked once

Telegraph must become a first-class asynchronous intelligence source triggered by meaningful NEMESIS case events.

---

## 7. Candidate Telegraph Intents

The following intents are current product-fit candidates.

They are CANDIDATES, not permanently hard-coded dependencies.

The implementation agent must inspect the current live Telegraph Miner registry, leaderboard, schemas, prices, status, and current documentation before locking them.

### 7.1 `FRAUD_DETECTION` — Core Candidate

Purpose:

Assess the risk profile of important recipient or destination addresses already discovered and verified by NEMESIS.

Example triggers:

- theft destination discovered
- materially significant new trace destination
- destination becomes potentially actionable
- dormant funds move to a new address

Telegraph output is enrichment only.

A high-risk result must never become proof that an address belongs to a thief or named real-world entity.

### 7.2 `ONCHAIN_TX_LOOKUP` — Core Candidate

Purpose:

Obtain an independent Telegraph-network intelligence response for an already known transaction.

Example triggers:

- initial theft transaction RPC-verified
- meaningful movement resumes
- important trace hop appears
- transaction leads into a potentially actionable endpoint

JSON-RPC remains the final blockchain source of truth.

A Telegraph mismatch must be persisted and exposed, not silently replace RPC evidence.

### 7.3 `WEB_SEARCH` / `NEWS_SEARCH` — Conditional Core Candidate

Purpose:

Add current public context at the moments where external information materially improves investigation or escalation.

Examples:

- exploit name or protocol is known
- actionable destination requires public service context
- related incident reporting may exist
- new movement occurs during an actively developing exploit

These calls should NOT fire on every case automatically.

They should be triggered when the case contains enough deterministic context to form a useful and narrow query.

### 7.4 `WALLET_BALANCE_CHECK` — Optional

Purpose:

Independent current-state snapshot for a destination or endpoint where present balance matters.

Only include this if live smoke testing shows it materially improves a core case flow.

Do not add it merely to increase the number of Telegraph intents used.

---

## 8. Live Miner Discovery Requirement

Do not hard-code specific miner IDs, slugs, leaderboard positions, schemas, prices, or scores into the product architecture.

At build start, create a discovery step that inspects current Telegraph state.

Collect for relevant intents:

- active compatible miners
- miner ID and slug
- activation state
- current leaderboard position / score where available
- request schema
- response schema
- endpoint mapping
- current price / x402 challenge behavior
- latency
- recent success/failure behavior
- signal mapping
- verification metadata
- availability of signal hashes / receipts
- fallback candidates

The product should primarily operate at the **Intent** level.

Preferred behavior:

```text
NEMESIS event
   ↓
required Telegraph Intent
   ↓
current eligible live miner set
   ↓
ranked/appropriate routing path
   ↓
real paid call
   ↓
normalized Telegraph receipt
```

If Telegraph's preferred router is unreliable in the deployed environment, the implementation may use an evidence-backed direct-miner fallback strategy.

Any fallback must:

- use the live registry/leaderboard
- select a compatible active miner
- record which routing mode was used
- record why fallback occurred
- never silently pretend it was normal routed behavior

---

## 9. Mandatory Pre-Implementation Spike

Before substantial code changes, Claude Code must perform a short live integration spike.

The spike should answer:

1. What are the current official Track 3 requirements?
2. What are the current official Telegraph integration APIs?
3. Which relevant intents are currently live?
4. Which miners currently serve those intents?
5. What input schemas do the strongest viable miners require?
6. What response shapes do they actually return?
7. What does a real x402 payment flow require today?
8. Does the primary Telegraph router work reliably from the planned deployment environment?
9. Is direct miner routing needed as a fallback?
10. What verification / `signal_hash` / payment metadata is returned?
11. What wallet/network/token is required for real calls?
12. What call cost and latency should NEMESIS expect?
13. Are there concurrency or settlement issues?
14. Which planned intents should be retained, replaced, or dropped based on evidence?

The agent must write findings to:

`docs/TELEGRAPH_LIVE_AUDIT.md`

The audit must distinguish:

- documented behavior
- observed live behavior
- assumptions
- unresolved risks

Only after this audit should the exact Telegraph adapter implementation be frozen.

---

## 10. Core Telegraph-Enhanced Investigation Workflow

### Phase 1 — Incident Intake

Existing NEMESIS behavior remains.

Input may be:

- affected wallet
- chain
- optional known theft transaction
- optional approximate incident time

No Telegraph call is necessary merely because a user opened a case.

### Phase 2 — Deterministic Incident Verification

Existing NEMESIS discovery and RPC workflow determines the theft transaction.

Only after a transaction passes deterministic RPC verification may it become a trigger for external Telegraph enrichment.

New logical event:

`CASE_INTELLIGENCE_REQUESTED`

This event should carry references to existing deterministic evidence, not duplicate untrusted facts.

### Phase 3 — Initial Telegraph Intelligence

For a verified theft transaction:

**Transaction Intelligence**  
Candidate Intent: `ONCHAIN_TX_LOOKUP`

Purpose: independent external intelligence for the verified theft transaction.

**Destination Risk Intelligence**  
Candidate Intent: `FRAUD_DETECTION`

Purpose: risk context for the already-verified recipient/destination.

These calls may execute asynchronously.

The user must not be forced to wait for Telegraph before the deterministic investigation can proceed.

### Phase 4 — Trace

Existing NEMESIS tracing remains authoritative.

As graph branches expand, Telegraph should NOT be called indiscriminately.

Introduce intelligence-trigger rules.

Candidate trigger conditions:

- first significant destination after theft
- large-value destination
- new destination that changes branch state
- potentially actionable endpoint
- movement after a dormancy period
- analyst/user explicitly requests external intelligence
- deterministic evidence creates a strong reason for current public-context research

The implementation agent may refine these trigger rules after inspecting current trace code and real demo cases.

The key constraint is:

> Telegraph requests must correspond to meaningful investigation events.

### Phase 5 — Dormancy

Existing behavior remains:

A branch may become `DORMANT`.

No Telegraph calls should be generated merely because Scheduler performs a routine check and no new movement exists.

### Phase 6 — Autonomous Movement Resume

This is the flagship Telegraph demo path.

Existing NEMESIS:

```text
DORMANT branch
   ↓
Scheduler recheck
   ↓
movement detected
   ↓
RPC verifies movement
   ↓
MOVEMENT_DETECTED event
   ↓
trace resumes
```

Telegraph-enhanced NEMESIS:

```text
DORMANT branch
   ↓
Scheduler recheck
   ↓
movement detected
   ↓
RPC verifies new movement
   ↓
MOVEMENT_DETECTED
   ↓
trace resumes
   ↓
TELEGRAPH_ENRICH
   ├── transaction intelligence
   ├── destination risk intelligence
   └── public context if justified
   ↓
receipts persisted
   ↓
case risk/context updated
   ↓
timeline updated automatically
```

No human should need to click “Run Telegraph.”

---

## 11. Actionable / Escalation Workflow

When a branch becomes potentially actionable, NEMESIS should assemble an escalation view from three explicitly separate layers:

### Deterministic Evidence

Examples:

- exact transaction hashes
- amounts
- timestamps
- token movements
- graph path
- final observed destination

### Telegraph Intelligence

Examples:

- fraud/risk intelligence
- transaction intelligence
- current public context
- selected miner
- routing mode
- result
- cost
- signal/payment verification

### Model Assessment

Gemini may:

- summarize
- prioritize
- explain
- prepare a bounded escalation package

Gemini may not:

- invent a transaction
- invent an address
- invent an identity
- treat a miner's guess as deterministic truth

---

## 12. Telegraph Receipt

Every successful or failed Telegraph attempt should produce a normalized record.

Suggested conceptual schema:

```ts
TelegraphReceipt {
  id
  caseId
  branchId?
  trigger
  intent

  routingMode
  minerId?
  minerSlug?

  targetType
  targetAddress?
  targetTx?

  requestSummary
  response
  label?
  confidence?
  riskScore?

  costUsd?
  durationMs?
  signalHash?
  paymentReference?
  verification?

  status
  error?

  createdAt
  rawResponseHash?
}
```

Exact fields should follow the live Telegraph response shape discovered during the integration spike.

Do not manufacture fields that Telegraph does not provide.

---

## 13. Persistence

Preferred new Firestore concept:

```text
cases/{caseId}/telegraph_receipts/{receiptId}
```

or an equivalent repository-consistent structure.

The agent may choose a different persistence shape if existing NEMESIS Firestore patterns strongly favor another design.

Requirements:

- receipt is linked to case
- optional link to branch / graph node / timeline event
- raw external result can be audited
- normalized fields support UI rendering
- failed calls remain visible
- retries are idempotent
- duplicate movement events do not create uncontrolled duplicate payments

Timeline should reference Telegraph receipts rather than copy large raw payloads.

---

## 14. Telegraph Adapter / Gateway

The integration should isolate Telegraph-specific concerns from the existing deterministic trace core.

Responsibilities include:

- live intent/miner discovery
- request-shape adaptation
- x402 payment handling
- retries
- routing
- direct fallback where justified
- spend limits
- response normalization
- verification metadata
- health checks
- error taxonomy

### Preferred Initial Architecture

A small isolated Telegraph integration service/module is preferred over scattering Telegraph/x402 logic through trace code.

One candidate is a Node/TypeScript Telegraph Gateway because Telegraph's current x402 ecosystem may be strongest there.

However this is NOT a hard requirement.

After the live audit, Claude Code may instead implement:

- a clean Python adapter inside FastAPI
- a separate Cloud Run microservice
- another minimal architecture

if it provides:

- reliable real x402 payment
- clean secret isolation
- testability
- low integration risk
- clear failure boundaries

The decision and evidence must be documented in:

`docs/TELEGRAPH_ARCHITECTURE_DECISION.md`

---

## 15. Secret and Payment Safety

Telegraph requires real paid calls.

Use a dedicated Telegraph payer wallet.

Requirements:

- never reuse a high-value personal wallet
- dedicated low-balance wallet
- private key stored only in appropriate secret storage
- never expose key to frontend
- per-call spending ceiling
- per-case spending ceiling
- daily spending ceiling
- clear low-balance / payment-failure status
- serial or controlled-concurrency payment execution if live testing shows facilitator concurrency issues

The product must fail safely if the payer wallet is unavailable.

NEMESIS tracing must continue without Telegraph enrichment.

---

## 16. Failure Model

Telegraph is an enrichment dependency, not a single point of failure.

If Telegraph fails:

```text
RPC evidence remains valid
trace continues
monitoring continues
case persists
Telegraph intelligence = unavailable / pending / failed
```

Never convert:

> Telegraph could not answer

into:

> No risk exists.

Never convert a miner disagreement into a fabricated consensus.

If two intelligence results conflict, persist and expose the disagreement.

---

## 17. UI Changes

Do not redesign NEMESIS from scratch.

Add Telegraph as a coherent evidence layer.

Recommended case-level sections:

### Onchain Evidence
RPC-verified facts.

### Telegraph Intelligence
External ranked miner intelligence.

### Agent Assessment
Gemini's evidence-grounded interpretation.

Possible graph-node intelligence treatment:

```text
0x84…9A

ONCHAIN
Received 84,211 USDC

TELEGRAPH RISK
High risk
FRAUD_DETECTION
Miner: <live selected miner>
Verified receipt

PUBLIC CONTEXT
3 relevant results
NEWS_SEARCH

[View intelligence proof]
```

Do not show values as live/verified unless they came from a real run.

---

## 18. Telegraph Intelligence Panel

Each receipt/detail view should make integration depth visible.

Useful fields:

- intent
- selected miner
- miner rank/selection source when available
- routing mode
- request target
- output
- risk/confidence semantics
- call cost
- latency
- timestamp
- verification status
- signal hash where provided
- payment proof/reference where provided

The UI should not dump raw JSON by default.

Raw payload may be available behind an expandable evidence view.

---

## 19. Demo Story

The final demo should prove one complete autonomous loop.

Recommended story:

1. Open NEMESIS.
2. Start from an affected wallet or known theft transaction.
3. NEMESIS discovers/verifies the incident.
4. RPC evidence appears.
5. Real Telegraph transaction intelligence runs.
6. Real Telegraph destination-risk intelligence runs.
7. Telegraph receipts visibly show real miner / intent / cost / verification evidence.
8. NEMESIS traces funds across the graph.
9. A branch reaches dormant state.
10. A controlled real/test path causes movement to appear.
11. NEMESIS detects movement autonomously.
12. RPC verifies it.
13. Trace resumes without user intervention.
14. Telegraph automatically re-enriches the new movement/destination.
15. Timeline updates.
16. Escalation view separates deterministic evidence, Telegraph intelligence, and Gemini assessment.

The controlled demo path must be truthfully labelled.

Do not claim synthetic movement as organic production activity.

---

## 20. Real Usage Strategy

Track 3 places meaningful weight on real usage.

Do not attempt to game request volume.

Legitimate usage paths may include:

- public live NEMESIS investigation demo
- shareable public case
- users running wallet investigations
- public demo cases that cause real Telegraph calls
- X posts inviting users to inspect or try real investigations
- limited public read-only case pages with visible Telegraph receipts

Usage analytics should distinguish:

- successful investigations
- Telegraph calls
- successful Telegraph answers
- distinct case/request identities where legitimately measurable
- failures

Do not invent “users” from internal test calls.

---

## 21. Observability

Add operational visibility for Telegraph.

Suggested health data:

```text
Telegraph:
  enabled
  payer balance
  registry reachable
  live intents available
  last successful call
  last selected miner
  last cost
  recent failure count
```

Do not expose secrets.

For debugging, logs should contain:

- case/event reference
- intent
- routing decision
- miner
- duration
- cost
- signal/payment reference
- normalized failure reason

Avoid logging complete sensitive user prose where unnecessary.

---

## 22. Testing

### Unit Tests

Must cover:

- intent selection rules
- trigger rules
- schema normalization
- failure handling
- conflicting results
- receipt persistence
- idempotency
- spend limits
- response-semantic handling
- risk vs confidence labeling
- routing fallback

### Integration Tests

Use real Telegraph calls for a limited set of controlled tests.

Must verify:

- one real paid request
- receipt returned
- miner identified
- cost recorded
- verification metadata captured
- Firestore persistence
- timeline linkage

### End-to-End

At least one deployed E2E path must demonstrate:

```text
real NEMESIS case
→ verified chain evidence
→ real Telegraph call
→ persisted receipt
→ visible UI intelligence
```

Preferred advanced E2E:

```text
dormant
→ movement
→ RPC verification
→ trace resume
→ automatic Telegraph enrichment
```

Mocks may be used in unit tests only where appropriate.

They cannot be presented as hackathon integration evidence.

---

## 23. Data / Evidence Boundaries

### Deterministic

Only deterministic providers may establish:

- transaction hash
- transaction existence
- sender
- recipient
- value
- token
- timestamp
- chain
- graph edge
- movement
- branch state

### Telegraph

May establish:

- what a specific miner returned
- the miner's risk/intelligence result
- current public information returned through Telegraph
- Telegraph routing/payment/verifiability metadata

### Gemini

May establish only:

- classification
- explanation
- prioritization
- summary
- escalation drafting

based on referenced evidence.

---

## 24. Attribution Boundary

A Telegraph result must never automatically become a real-world identity claim.

The product must not claim:

- thief identity from address alone
- exchange customer identity
- private KYC access
- guaranteed exchange ownership
- guaranteed asset recovery
- guaranteed freezing
- law-enforcement access

Public context can be useful without pretending it is private attribution.

---

## 25. Architecture Evolution

Existing NEMESIS flow:

```text
User
↓
FastAPI
↓
Discovery / RPC
↓
Deterministic evidence
↓
Trace engine
↓
Firestore
↓
Gemini
↓
Scheduler / PubSub monitoring
↓
Frontend
```

Target Telegraph-aware flow:

```text
User
↓
FastAPI
↓
Discovery / RPC
↓
Deterministic evidence
↓
Trace engine
↓
Firestore
↓
Case event / intelligence trigger
↓
Telegraph adapter/gateway
↓
Live Telegraph registry/routing
↓
Real x402-paid miner
↓
Normalized Telegraph receipt
↓
Firestore
↓
Timeline / graph intelligence
↓
Gemini bounded interpretation
↓
Frontend

Scheduler / PubSub
↓
Movement detected
↓
RPC verified
↓
Trace resumes
↓
Telegraph re-enrichment fires automatically
```

---

## 26. Recommended Build Order

### Milestone 0 — Protect Original Submission

- confirm original repo HEAD
- record fork SHA
- create new repository
- preserve history
- update README disclosure
- ensure old Cloud Run services remain untouched

**Stop condition:** new repo exists and original remains unchanged.

### Milestone 1 — Live Telegraph Audit

- inspect latest rules
- inspect official docs
- inspect live intents
- inspect live miners
- inspect leaderboard
- smoke-test candidate intents
- test x402
- measure latency
- capture response schemas
- capture receipts / signal hashes
- decide adapter architecture

Deliverables:

- `docs/TELEGRAPH_LIVE_AUDIT.md`
- `docs/TELEGRAPH_ARCHITECTURE_DECISION.md`

**Stop condition:** at least one real paid miner call works outside mocks.

### Milestone 2 — Telegraph Adapter

- implementation
- payer safety
- live registry access
- intent routing
- fallback logic
- normalization
- spend controls
- tests

**Stop condition:** backend can request and normalize a real Telegraph intelligence result.

### Milestone 3 — Case Persistence

- Telegraph receipt data model
- Firestore persistence
- idempotency
- case/timeline linking

**Stop condition:** real Telegraph receipt survives process restart and appears on saved case.

### Milestone 4 — Initial Incident Integration

- verified theft transaction trigger
- transaction intelligence
- destination risk intelligence
- non-blocking async behavior

**Stop condition:** one real investigation automatically produces Telegraph intelligence.

### Milestone 5 — Autonomous Resume Integration

- wire `MOVEMENT_DETECTED`
- invoke Telegraph only after RPC verification
- re-enrich new movement/destination
- prevent duplicate payment calls

**Stop condition:** dormant → movement → resume → real Telegraph enrichment works without manual click.

### Milestone 6 — Public Context

- add conditional WEB/NEWS intelligence
- narrow trigger logic
- persist sources/result
- include in escalation when justified

**Stop condition:** public context improves one real/demo escalation path without spamming calls.

### Milestone 7 — UI

- Telegraph Intelligence section
- graph-node intelligence
- receipt detail
- timeline events
- loading/pending/failure states
- evidence boundaries visually clear

**Stop condition:** judge can understand Telegraph's role without opening source code.

### Milestone 8 — Deployment

Deploy separate Telegraph-specific services.

Do not reuse/overwrite original submitted service URLs.

Verify:

- frontend
- API
- Telegraph adapter/gateway if separate
- Firestore
- Pub/Sub
- Scheduler
- Secret Manager
- payer wallet
- CORS/auth
- health
- running Git SHA

### Milestone 9 — Live E2E and Submission

- run real paid E2E
- capture evidence
- verify no mocks
- prepare public X posts
- verify Track 3 submission portal
- join/check official Discord
- prepare README
- prepare architecture diagram
- prepare demo video
- confirm public app access
- final rule audit

---

## 27. Non-Goals

Do not spend hackathon time building:

- a generic Telegraph miner marketplace
- a new miner
- a new WASM scorer
- Telegram bot integration
- cross-chain support beyond what NEMESIS already safely supports
- new token economics
- unnecessary smart contracts
- a complete exchange-attribution database
- new Gemini agent hierarchy merely for appearance
- every possible Telegraph intent
- miner leaderboards for users
- artificial traffic generators

---

## 28. Implementation Freedom

This PRD locks PRODUCT BEHAVIOR and EVIDENCE BOUNDARIES.

It intentionally does not hard-code every implementation detail.

Claude Code is expected to reason from:

- the current NEMESIS source
- current Telegraph official docs
- live Telegraph registry state
- real smoke-test results
- existing deployment architecture
- actual x402 SDK/runtime behavior

The agent may improve:

- module boundaries
- async job design
- retry strategy
- gateway language
- response normalization
- trigger implementation
- Firestore shape
- UI component structure

provided the change:

1. preserves deterministic evidence boundaries,
2. uses real Telegraph miners,
3. improves reliability or simplicity,
4. does not weaken existing NEMESIS capabilities,
5. is documented,
6. is tested.

The agent must not silently remove accepted scope because an integration is difficult.

Blocked or deferred items must remain visible in an integration ledger.

---

## 29. Integration Ledger

Create and maintain:

`docs/TELEGRAPH_INTEGRATION_LEDGER.md`

Suggested format:

| Integration / Capability | Why | Required? | Status | Evidence / Blocker |
|---|---|---:|---|---|
| Live miner registry | dynamic discovery | Yes | Planned | |
| x402 payment | real Track 3 usage | Yes | Planned | |
| FRAUD_DETECTION | destination risk | Candidate Core | Planned | |
| ONCHAIN_TX_LOOKUP | tx intelligence | Candidate Core | Planned | |
| WEB/NEWS | public context | Conditional | Planned | |
| Telegraph receipt persistence | proof | Yes | Planned | |
| MOVEMENT_DETECTED re-enrichment | autonomy | Yes | Planned | |
| UI intelligence view | judge/user comprehension | Yes | Planned | |

Allowed statuses:

- Planned
- Credential needed
- Blocked
- Implemented
- Locally tested
- Deployed
- Production verified
- Deferred by explicit decision

---

## 30. Acceptance Criteria

The Telegraph build is NOT complete until all critical criteria pass.

### Repository Safety
- original repo unchanged
- new repo clearly disclosed
- fork SHA documented

### Real Telegraph
- real miner calls
- real payment path
- no mocked hackathon evidence
- selected miner recorded
- actual result persisted

### Product Integration
- Telegraph fires from real case events
- at least one initial-investigation trigger
- autonomous movement-resume trigger
- tracing does not depend on Telegraph availability

### Evidence Integrity
- RPC remains source of chain truth
- Telegraph clearly labelled external intelligence
- Gemini remains bounded interpretation
- attribution claims stay guarded

### UI
- judge can see what Telegraph did
- receipt/proof available
- failures honestly shown
- no generic “Powered by Telegraph” substitute for functionality

### Deployment
- separate Telegraph deployment
- live public path
- Git SHA verifiable
- payer secrets safe

### Submission
- rules re-checked
- Discord checked
- submission form checked
- X requirements prepared
- demo shows real miner activity

---

## 31. Flagship Demo Definition

The highest-value demo is:

> A previously dormant stolen-fund branch moves again. NEMESIS detects the movement without user intervention, verifies it independently over RPC, resumes tracing from persisted state, then automatically requests fresh Telegraph transaction and destination intelligence, persists the paid verified receipts, updates the case timeline, and presents a stronger escalation view.

This single loop should receive priority over adding many shallow Telegraph features.

---

## 32. Final Build Rule

> Do not integrate Telegraph for the culture.

Every Telegraph call must answer a real investigative question.

Every external result must remain distinguishable from deterministic blockchain truth.

Every important call must leave evidence.

And the strongest proof of integration is not a button — it is NEMESIS waking up, seeing new verified movement, and autonomously pulling fresh Telegraph intelligence because the case changed.
