import test from "node:test";
import assert from "node:assert/strict";
import { DurableDailySpend } from "../dist/durable-spend.js";

const TOKEN_URL = "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token";

function harness({ tokenOk = true, doc = null, docStatus = 200, commitOk = true } = {}) {
  const calls = { commits: [] };
  const fetchImpl = async (url, init) => {
    const target = String(url);
    if (target === TOKEN_URL) {
      return tokenOk
        ? new Response(JSON.stringify({ access_token: "tok", expires_in: 3600 }), { status: 200 })
        : new Response("no", { status: 500 });
    }
    if (target.endsWith(":commit")) {
      calls.commits.push(JSON.parse(init.body));
      return new Response("{}", { status: commitOk ? 200 : 500 });
    }
    if (docStatus !== 200) return new Response("{}", { status: docStatus });
    return new Response(JSON.stringify(doc ?? { fields: { spent_usd: { doubleValue: 0 } } }), { status: 200 });
  };
  const ledger = new DurableDailySpend("proj", "nemesis-telegraph", "telegraph_spend", fetchImpl, () => new Date("2026-09-05T10:00:00Z"));
  return { ledger, calls };
}

test("reads a persisted daily total", async () => {
  const { ledger } = harness({ doc: { fields: { spent_usd: { doubleValue: 0.04 } } } });
  assert.equal(await ledger.total(), 0.04);
});

test("a day with no document yet is genuinely zero", async () => {
  const { ledger } = harness({ docStatus: 404 });
  assert.equal(await ledger.total(), 0);
});

test("an unreachable store returns null, never zero", async () => {
  // This is the whole point: a restart or an outage must not look like an
  // untouched budget, which is how the in-memory ledger let spend escape.
  const { ledger } = harness({ tokenOk: false });
  assert.equal(await ledger.total(), null);

  const broken = harness({ docStatus: 503 });
  assert.equal(await broken.ledger.total(), null);
});

test("spend is added with a server-side increment so writers cannot clobber", async () => {
  const { ledger, calls } = harness();
  assert.equal(await ledger.add(0.01), true);
  const transform = calls.commits[0].writes[0].transform;
  assert.match(transform.document, /telegraph_spend\/2026-09-05$/);
  assert.deepEqual(transform.fieldTransforms[0], { fieldPath: "spent_usd", increment: { doubleValue: 0.01 } });
});

test("a failed write reports failure rather than pretending it recorded", async () => {
  const { ledger } = harness({ commitOk: false });
  assert.equal(await ledger.add(0.01), false);
});

test("the counter is keyed by UTC day", async () => {
  const fetchImpl = async (url) =>
    String(url) === TOKEN_URL
      ? new Response(JSON.stringify({ access_token: "t", expires_in: 3600 }), { status: 200 })
      : new Response("{}", { status: 404 });
  let clock = new Date("2026-09-05T23:59:00Z");
  const ledger = new DurableDailySpend("p", "db", "telegraph_spend", fetchImpl, () => clock);
  assert.equal(await ledger.total(), 0);
  clock = new Date("2026-09-06T00:01:00Z");
  assert.equal(await ledger.total(), 0);
});

test("an unconfigured ledger declares itself unconfigured", () => {
  assert.equal(new DurableDailySpend("", "").configured, false);
  assert.equal(new DurableDailySpend("p", "").configured, false);
  assert.equal(new DurableDailySpend("p", "db").configured, true);
});
