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
  assert.match(provisional, /is <b>not proven<\/b>/);
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
  assert.match(provisional, /RPC verified/);
  assert.match(provisional, /moved value out of this wallet/);
});
