import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const build = readFileSync(new URL("../cloudbuild.telegraph-frontend.yaml", import.meta.url), "utf8");
const gate = readFileSync(new URL("../app/auth-gate.tsx", import.meta.url), "utf8");

const REQUIRED = [
  "NEXT_PUBLIC_FIREBASE_API_KEY",
  "NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN",
  "NEXT_PUBLIC_FIREBASE_PROJECT_ID",
  "NEXT_PUBLIC_FIREBASE_APP_ID"
];

function substitution(name) {
  const match = new RegExp(`^  ${name}:\\s*"?([^"\\n]*)"?\\s*$`, "m").exec(build);
  return match ? match[1].trim() : null;
}

test("the frontend build passes every Firebase value the client needs", () => {
  for (const key of REQUIRED) {
    assert.ok(build.includes(`${key}=\${_${key.replace("NEXT_PUBLIC_", "")}}`), `${key} is not passed as a build arg`);
  }
});

test("no Firebase substitution is left empty, which is what disabled sign-in", () => {
  // An empty value here is not a broken build, it is a silently signed-out
  // app: the gate treats missing config as "auth unavailable" and carries on.
  for (const name of ["_FIREBASE_API_KEY", "_FIREBASE_AUTH_DOMAIN", "_FIREBASE_PROJECT_ID", "_FIREBASE_APP_ID"]) {
    const value = substitution(name);
    assert.ok(value && value.length > 0, `${name} is empty`);
  }
});

test("the configured Firebase project matches the API that verifies the tokens", () => {
  assert.equal(substitution("_FIREBASE_PROJECT_ID"), "nemesis-506114");
  assert.equal(substitution("_FIREBASE_AUTH_DOMAIN"), "nemesis-506114.firebaseapp.com");
});

test("the frontend build points at the Telegraph API, never the original", () => {
  const api = substitution("_API_URL");
  assert.match(api, /nemesis-telegraph-api/);
  assert.doesNotMatch(api, /nemesis-api-staging/);
});

test("only public client identifiers are shipped to the browser", () => {
  // A Firebase web key is a public project identifier. A private key is not,
  // and must never appear in anything that reaches a browser.
  assert.doesNotMatch(build, /0x[0-9a-fA-F]{64}/, "a private key shaped value is in the frontend build");
  assert.doesNotMatch(build, /TELEGRAPH_EVM_PRIVATE_KEY/);
  assert.doesNotMatch(build, /TELEGRAPH_INTERNAL_TOKEN/);
});

test("the app treats missing configuration as signed out rather than crashing", () => {
  assert.match(gate, /const configured=Boolean\(/);
  assert.match(gate, /configured\?\(getApps\(\)\[0\]\|\|initializeApp\(firebaseConfig\)\):null/);
});

test("a domain the provider has not allowed is explained, not left generic", () => {
  assert.match(gate, /auth\/unauthorized-domain/);
  assert.match(gate, /Use your email and password instead/);
});

test("every request carries a freshly minted token", () => {
  // getIdToken refreshes on expiry, so a long judging session does not start
  // failing an hour in.
  assert.match(gate, /await current\.getIdToken\(\)/);
  assert.match(gate, /onAuthStateChanged\(auth/);
});

// --- wallet-first: ambiguity must not dead-end the investigation ---
const page = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
const provisional = readFileSync(new URL("../app/provisional-incident.tsx", import.meta.url), "utf8");

test("the case screen renders a provisional incident instead of blocking", () => {
  assert.match(page, /PROVISIONAL_INCIDENT/);
  assert.match(page, /<ProvisionalIncident/);
});

test("a provisional pick is labelled likely, never proven", () => {
  assert.match(provisional, /LIKELY INCIDENT IDENTIFIED/);
  assert.match(provisional, /NOT A CONFIDENT SELECTION/);
  assert.match(provisional, /still provisional<\/b>/);
});

test("selection confidence is shown honestly rather than hidden", () => {
  assert.match(provisional, /Math\.round\(confidence\*100\)/);
  assert.match(provisional, /SELECTION CONFIDENCE/);
});

test("alternatives stay reachable as an override, behind a disclosure", () => {
  assert.match(provisional, /other plausible transactions/);
  assert.match(provisional, /Investigate this instead/);
  assert.match(provisional, /useState\(false\)/);
});

test("the provisional panel still states the transaction itself is verified", () => {
  assert.match(provisional, /verified onchain/);
  assert.match(provisional, /moved funds from this wallet/);
});

// --- judge-facing overview ---
const overview = readFileSync(new URL("../app/case-overview.tsx", import.meta.url), "utf8");
const panel = readFileSync(new URL("../app/telegraph-panel.tsx", import.meta.url), "utf8");

test("overview routes to each section instead of repeating it", () => {
  for (const id of ["evidence", "graph", "intelligence", "assessment", "timeline"]) {
    assert.ok(overview.includes(`go("${id}")`) || overview.includes(`id:"${id}"`), `no route to ${id}`);
  }
  assert.match(overview, /VERIFIED EVIDENCE/);
  assert.match(overview, /FUND TRACE/);
  assert.match(overview, /TELEGRAPH INTELLIGENCE/);
  assert.match(overview, /AGENT ASSESSMENT/);
});

test("overview offers a direct route into Telegraph and the timeline", () => {
  assert.match(overview, /View Telegraph intelligence →/);
  assert.match(overview, /View full timeline →/);
});

test("the real case overview previews rather than repeating the sections", () => {
  // The synthetic demo screen keeps its own simpler layout; this is about the
  // real investigation, where Overview must route instead of duplicating.
  assert.match(page, /\{section==="overview"&&<CaseOverview/);
  assert.match(page, /\{section==="intelligence"&&<TelegraphPanel/);
  assert.match(page, /\{section==="evidence"&&<section className="panel escalation chainPlane">/);
  assert.doesNotMatch(page, /\(section==="overview"\|\|section==="intelligence"\)/);
});

test("Telegraph is described as a product capability, not integration work", () => {
  assert.doesNotMatch(overview, /WHAT TELEGRAPH ADDED/);
  assert.doesNotMatch(panel, /WHAT TELEGRAPH ADDED/);
  assert.match(panel, /How Telegraph strengthened this investigation/);
  assert.match(panel, /purchased automatically/);
});

test("a paid receipt states the x402 loop in one line", () => {
  assert.match(panel, /Paid <b>\{\(r\.reported_cost_usd\?\?0\.01\)\.toFixed\(2\)\} USDC<\/b> via x402/);
  assert.match(panel, /Base Sepolia testnet/);
  assert.match(panel, /Payment settled/);
  assert.match(panel, /View payment proof/);
  assert.match(panel, /Open settlement on block explorer/);
});

test("skipped calls read as product language, with the policy string demoted", () => {
  assert.match(panel, /MINER CALL SKIPPED/);
  assert.match(panel, /Case intelligence budget reached/);
  assert.match(panel, /Technical details/);
  assert.match(panel, /\["Policy reason"/);
});

test("the landing CTAs do different things", () => {
  assert.match(page, /Explore the system/);
  assert.match(page, /getElementById\("system"\)\?\.scrollIntoView/);
});

// --- clarity + intelligence quality ---
test("Assessment is its own destination, not a detour into Evidence", () => {
  assert.match(page, /section==="assessment"/);
  assert.match(page, /◆ Assessment/);
  assert.match(overview, /id:"assessment",title:"AGENT ASSESSMENT"/);
});

test("primary copy does not speak in infrastructure terms", () => {
  for (const jargon of [/JSON-RPC/, /RPC verified/, /RPC confirmed/]) {
    assert.doesNotMatch(overview, jargon, `overview leaks ${jargon}`);
  }
  assert.match(overview, /verified this transaction directly on the blockchain/);
});

test("an unusable answer is never repeated as a finding", () => {
  assert.match(panel, /NO CASE-SPECIFIC SIGNAL/);
  assert.match(panel, /No case-specific signal returned/);
  assert.match(panel, /CONFLICTED · NOT ACCEPTED/);
  assert.match(panel, /state==="NO_CASE_SIGNAL"\)return/);
});

test("the summary separates responses purchased from intelligence accepted", () => {
  assert.match(panel, /RESPONSES PURCHASED/);
  assert.match(panel, /ACCEPTED INTELLIGENCE/);
  assert.match(panel, /NO CASE SIGNAL/);
  assert.match(overview, /ACCEPTED INTELLIGENCE/);
  assert.match(overview, /MINER RESPONSES/);
});

test("a conflict is described against the chain, not against a protocol name", () => {
  assert.match(panel, /This answer conflicts with the blockchain/);
  assert.doesNotMatch(panel, /Telegraph disagrees with RPC/);
});

test("uncertainty about the compromise method reads as a sentence", () => {
  assert.match(page, /Not yet determined/);
  assert.match(page, /not enough verified evidence yet to determine how the wallet was compromised/);
});

test("no case surface speaks in protocol jargon", () => {
  for (const file of [overview, panel, provisional]) {
    assert.doesNotMatch(file, /JSON-RPC/);
    assert.doesNotMatch(file, /RPC verified/);
  }
});
