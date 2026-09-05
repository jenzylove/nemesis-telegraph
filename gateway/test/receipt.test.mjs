import test from "node:test";
import assert from "node:assert/strict";
import { decodePaymentResponse, findSettlementReference, hashRaw, normalizeResponse } from "../dist/receipt.js";

/** The real routed body observed on 2026-09-05, trimmed to the fields that matter. */
const settledBody = {
  miner_id: "302",
  miner_name: "ChainSight — On-Chain Intelligence Hub",
  intent: "ONCHAIN_TX_LOOKUP",
  cost_usd: 0.01,
  duration_ms: 1046,
  signal_hash: "0x273ba7a9af69491ef294b0e5c3c30c249016209238d02ee28f1b52dd31aa5bc0",
  result: { status: "ok", block_number: 21895251, source: "rpc" }
};

test("normalizes the observed routed response", () => {
  const normalized = normalizeResponse(settledBody, "ONCHAIN_TX_LOOKUP");
  assert.equal(normalized.miner_id, "302");
  assert.equal(normalized.returned_intent, "ONCHAIN_TX_LOOKUP");
  assert.equal(normalized.intent_matched, true);
  assert.equal(normalized.reported_cost_usd, 0.01);
  assert.equal(normalized.reported_duration_ms, 1046);
  assert.equal(normalized.signal_hash, settledBody.signal_hash);
  assert.equal(normalized.verification, null);
});

test("reads the miner from miner_used when miner_id is absent", () => {
  const normalized = normalizeResponse({ miner_used: 900, result: {} }, "FRAUD_DETECTION");
  assert.equal(normalized.miner_id, "900");
});

test("flags an intent mismatch instead of accepting the answer", () => {
  const normalized = normalizeResponse({ ...settledBody, intent: "WEB_SEARCH" }, "ONCHAIN_TX_LOOKUP");
  assert.equal(normalized.intent_matched, false);
});

test("leaves intent_matched unknown when the router reports no intent", () => {
  const normalized = normalizeResponse({ miner_id: "1", result: {} }, "ONCHAIN_TX_LOOKUP");
  assert.equal(normalized.returned_intent, null);
  assert.equal(normalized.intent_matched, null);
});

test("never synthesizes a signal hash or verification object", () => {
  const normalized = normalizeResponse({ miner_id: "1", result: { verdict: "ok" } }, "FRAUD_DETECTION");
  assert.equal(normalized.signal_hash, null);
  assert.equal(normalized.verification, null);
});

test("finds a signal hash nested inside the result", () => {
  const normalized = normalizeResponse({ result: { signal_hash: "0xabc" } }, "FRAUD_DETECTION");
  assert.equal(normalized.signal_hash, "0xabc");
});

test("decodes the observed PAYMENT-RESPONSE envelope", () => {
  const envelope = {
    success: true,
    payer: "0x8827d3af20efe02582aea67a5e704c04bad52324",
    transaction: "0x869b4b7c0b1fc47138b687de70472c2e90b26df23ef7b5c2b1dec541b8e2fc6e",
    network: "eip155:84532"
  };
  const header = Buffer.from(JSON.stringify(envelope), "utf8").toString("base64");
  const decoded = decodePaymentResponse(header);
  assert.deepEqual(decoded, envelope);
  assert.equal(findSettlementReference(decoded), envelope.transaction);
});

test("keeps an undecodable payment header rather than dropping it", () => {
  const decoded = decodePaymentResponse("!!!not-base64-json!!!");
  assert.equal(decoded.encoding, "opaque");
});

test("returns no settlement reference when the header is absent", () => {
  assert.equal(decodePaymentResponse(null), null);
  assert.equal(findSettlementReference(null), null);
});

test("ignores a settlement field that is not a transaction hash", () => {
  assert.equal(findSettlementReference({ transaction: "pending" }), null);
});

test("hashes the raw response stably", () => {
  assert.equal(hashRaw(settledBody), hashRaw({ ...settledBody }));
  assert.notEqual(hashRaw(settledBody), hashRaw({ ...settledBody, miner_id: "303" }));
});
