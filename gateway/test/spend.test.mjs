import test from "node:test";
import assert from "node:assert/strict";
import { SerialQueue, SpendLedger, SpendLimitExceeded } from "../dist/spend.js";
import { MinerRegistry, parseMiners } from "../dist/registry.js";

const ceilings = { perCallUsd: 0.01, perCaseEventUsd: 0.03, dailyUsd: 0.1 };

test("authorizes a call inside every ceiling", () => {
  const ledger = new SpendLedger(ceilings);
  ledger.authorize("case:MOVEMENT_DETECTED", 0.01);
});

test("refuses a single call above the per-call ceiling", () => {
  const ledger = new SpendLedger(ceilings);
  assert.throws(() => ledger.authorize("case:trigger", 0.02), SpendLimitExceeded);
});

test("refuses a fourth cent on the same case event", () => {
  const ledger = new SpendLedger(ceilings);
  for (let i = 0; i < 3; i += 1) {
    ledger.authorize("case:MOVEMENT_DETECTED", 0.01);
    ledger.record("case:MOVEMENT_DETECTED", 0.01);
  }
  assert.throws(() => ledger.authorize("case:MOVEMENT_DETECTED", 0.01), /Case event/);
});

test("separate case events do not share the per-event ceiling", () => {
  const ledger = new SpendLedger(ceilings);
  for (let i = 0; i < 3; i += 1) {
    ledger.record("caseA:MOVEMENT_DETECTED", 0.01);
  }
  ledger.authorize("caseB:MOVEMENT_DETECTED", 0.01);
});

test("refuses spend past the daily ceiling", () => {
  const ledger = new SpendLedger(ceilings);
  for (let i = 0; i < 10; i += 1) {
    ledger.record("case" + i + ":t", 0.01);
  }
  assert.throws(() => ledger.authorize("caseX:t", 0.01), /Daily spend/);
});

test("the daily total resets when the date rolls over", () => {
  let today = "2026-09-05T12:00:00Z";
  const ledger = new SpendLedger(ceilings, () => new Date(today));
  for (let i = 0; i < 10; i += 1) {
    ledger.record("case" + i + ":t", 0.01);
  }
  assert.throws(() => ledger.authorize("caseX:t", 0.01), /Daily spend/);
  today = "2026-09-06T00:00:01Z";
  ledger.authorize("caseX:t", 0.01);
  assert.equal(ledger.snapshot().spent_today_usd, 0);
});

test("only settled spend is counted, so a failed call frees its budget", () => {
  const ledger = new SpendLedger(ceilings);
  ledger.authorize("case:t", 0.01);
  // The call failed, so nothing is recorded.
  assert.equal(ledger.snapshot().spent_today_usd, 0);
});

test("payments run strictly one at a time", async () => {
  const queue = new SerialQueue();
  const order = [];
  let active = 0;
  let peak = 0;
  const task = (label) => async () => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    order.push(label);
    active -= 1;
  };
  await Promise.all([queue.run(task("a")), queue.run(task("b")), queue.run(task("c"))]);
  assert.equal(peak, 1);
  assert.deepEqual(order, ["a", "b", "c"]);
});

test("a rejected payment does not wedge the queue", async () => {
  const queue = new SerialQueue();
  await assert.rejects(queue.run(async () => { throw new Error("payment failed"); }));
  assert.equal(await queue.run(async () => "next call still runs"), "next call still runs");
});

test("parses the miner shapes discovery has returned", () => {
  assert.deepEqual(
    parseMiners({ miners: [{ miner_id: 302, name: "ChainSight", active: true }] }).map((m) => m.miner_id),
    ["302"]
  );
  assert.deepEqual(parseMiners([{ id: "900", name: "OnChain Intel" }]).map((m) => m.miner_id), ["900"]);
  assert.deepEqual(parseMiners({ data: [{ minerId: "7307" }] }).map((m) => m.miner_id), ["7307"]);
  assert.deepEqual(parseMiners({ miners: [{ name: "no id" }] }), []);
  assert.deepEqual(parseMiners(null), []);
});

test("registry caches within the TTL and serves the last good snapshot on failure", async () => {
  let calls = 0;
  let fail = false;
  let clock = 1000;
  const fetchImpl = async () => {
    calls += 1;
    if (fail) throw new Error("registry down");
    return new Response(JSON.stringify({ miners: [{ miner_id: "302", active: true }] }), { status: 200 });
  };
  const registry = new MinerRegistry(
    { engineBaseUrl: "http://engine", registryTtlMs: 1000 },
    fetchImpl,
    () => clock
  );
  await registry.minersFor("ONCHAIN_TX_LOOKUP");
  await registry.minersFor("ONCHAIN_TX_LOOKUP");
  assert.equal(calls, 1, "second lookup inside the TTL should be served from cache");

  clock += 2000;
  fail = true;
  const snapshot = await registry.minersFor("ONCHAIN_TX_LOOKUP");
  assert.equal(snapshot.miners[0].miner_id, "302", "an outage should fall back to the last good snapshot");
});

test("registry raises when it has never succeeded", async () => {
  const registry = new MinerRegistry(
    { engineBaseUrl: "http://engine", registryTtlMs: 1000 },
    async () => { throw new Error("registry down"); },
    () => 0
  );
  await assert.rejects(registry.minersFor("FRAUD_DETECTION"), /registry down/);
});

test("fallback candidate skips the miner the router already used", async () => {
  const registry = new MinerRegistry(
    { engineBaseUrl: "http://engine", registryTtlMs: 1000 },
    async () => new Response(JSON.stringify({ miners: [
      { miner_id: "302", active: true },
      { miner_id: "10002", active: true }
    ] }), { status: 200 }),
    () => 0
  );
  const candidate = await registry.fallbackCandidate("ONCHAIN_TX_LOOKUP", "302");
  assert.equal(candidate.miner_id, "10002");
});

test("fallback candidate ignores inactive miners", async () => {
  const registry = new MinerRegistry(
    { engineBaseUrl: "http://engine", registryTtlMs: 1000 },
    async () => new Response(JSON.stringify({ miners: [{ miner_id: "302", active: false }] }), { status: 200 }),
    () => 0
  );
  assert.equal(await registry.fallbackCandidate("ONCHAIN_TX_LOOKUP", null), null);
});
