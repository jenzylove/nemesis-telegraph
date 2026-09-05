import test from "node:test";
import assert from "node:assert/strict";
import {shortHex, telegraphProof, telegraphVerdict} from "../app/telegraph-semantics.mjs";

function receipt(overrides = {}) {
  return {
    status: "SUCCEEDED", label: "elevated_risk", risk_score: 0.4, signal_hash: null,
    payment: {settlement_transaction: null}, ...overrides
  };
}

test("a real risk figure renders as a risk verdict", () => {
  assert.deepEqual(telegraphVerdict(receipt({risk_score: 0.62, label: "high_risk"})), {
    tone: "risk", text: "high_risk · 0.62"
  });
  assert.equal(telegraphVerdict(receipt({risk_score: 0.4})).tone, "low");
});

test("a miner with nothing to say never reads as clean", () => {
  // The real SarzOps reply: verdict RECHECK, no wallet telemetry at all.
  const v = telegraphVerdict(receipt({label: "NO_EXTERNAL_SIGNAL", risk_score: null}));
  assert.equal(v.tone, "unknown");
  assert.equal(v.text, "No external signal");
  assert.doesNotMatch(v.text.toLowerCase(), /clean|safe|clear|no risk/);
});

test("a failed call reads as no answer, not as a result", () => {
  const v = telegraphVerdict(receipt({status: "FAILED", label: null, risk_score: null}));
  assert.equal(v.tone, "failed");
  assert.equal(v.text, "No answer");
});

test("a failed call cannot be rescued into a verdict by a stale label", () => {
  assert.equal(telegraphVerdict(receipt({status: "FAILED", label: "low_risk", risk_score: 0.1})).text, "No answer");
});

test("an answer with no risk figure stays informational", () => {
  assert.deepEqual(telegraphVerdict(receipt({risk_score: null, label: "ok"})), {tone: "info", text: "ok"});
});

test("a missing receipt is treated as no answer", () => {
  assert.equal(telegraphVerdict(null).tone, "failed");
});

test("proof is claimed only where Telegraph returned it", () => {
  assert.equal(telegraphProof(receipt()).hasProof, false);
  assert.equal(telegraphProof(receipt({signal_hash: "0xabc"})).hasProof, true);
  assert.equal(telegraphProof(receipt({payment: {settlement_transaction: "0xdef"}})).hasProof, true);
  assert.equal(telegraphProof({}).hasProof, false);
});

test("hashes are shortened without losing their ends", () => {
  const hash = "0x869b4b7c0b1fc47138b687de70472c2e90b26df23ef7b5c2b1dec541b8e2fc6e";
  const shortened = shortHex(hash);
  assert.ok(shortened.startsWith("0x869b4b"));
  assert.ok(shortened.endsWith("e2fc6e"));
  assert.equal(shortHex(null), "—");
  assert.equal(shortHex("0x1234"), "0x1234");
});
