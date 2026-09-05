import test from "node:test";
import assert from "node:assert/strict";
import { atomicToUsdc, decodeChallengeHeader, publicOffer, validateChallenge } from "../dist/challenge.js";

const config = {
  network: "eip155:84532",
  asset: "0x036cbd53842c5426634e7929541ec2318f3dcf7e",
  payee: "0x5a2324aa18613fad4e44bdf0d6c73ec1f6d87ff8",
  maxAmountAtomic: 10000n
};

const goodOffer = {
  scheme: "exact",
  network: "eip155:84532",
  asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  amount: "10000",
  payTo: "0x5a2324aA18613FAD4e44bDF0d6c73Ec1f6D87ff8",
  maxTimeoutSeconds: 60
};

const solanaOffer = {
  scheme: "exact",
  network: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
  asset: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPPJgZJDncDU",
  amount: "10000",
  payTo: "G53EbeTZSNsAn7bj6iMFUQnq3zpDdEbHhKkPRywo8bix"
};

/** The exact challenge shape the live router returned on 2026-09-05. */
function challenge(overrides = {}) {
  return { x402Version: 2, accepts: [goodOffer, solanaOffer], ...overrides };
}

test("accepts the audited live challenge and ignores the other network", () => {
  const approved = validateChallenge(challenge(), config);
  assert.equal(approved.network, "eip155:84532");
  assert.equal(approved.amount, "10000");
});

test("rejects an unexpected payee", () => {
  const tampered = challenge({ accepts: [{ ...goodOffer, payTo: "0x000000000000000000000000000000000000dead" }] });
  assert.throws(() => validateChallenge(tampered, config), /Rejected payee/);
});

test("rejects an unexpected asset", () => {
  const tampered = challenge({ accepts: [{ ...goodOffer, asset: "0x0000000000000000000000000000000000000001" }] });
  assert.throws(() => validateChallenge(tampered, config), /Rejected asset/);
});

test("rejects an amount above the ceiling", () => {
  const tampered = challenge({ accepts: [{ ...goodOffer, amount: "10001" }] });
  assert.throws(() => validateChallenge(tampered, config), /above ceiling/);
});

test("rejects a scheme the gateway cannot reason about", () => {
  const tampered = challenge({ accepts: [{ ...goodOffer, scheme: "upto" }] });
  assert.throws(() => validateChallenge(tampered, config), /Rejected scheme/);
});

test("rejects a protocol version other than v2", () => {
  assert.throws(() => validateChallenge(challenge({ x402Version: 1 }), config), /Rejected x402 version/);
});

test("rejects a challenge with no offer on the configured network", () => {
  assert.throws(() => validateChallenge(challenge({ accepts: [solanaOffer] }), config), /Expected exactly one/);
});

test("rejects duplicate offers on the configured network rather than guessing", () => {
  assert.throws(() => validateChallenge(challenge({ accepts: [goodOffer, goodOffer] }), config), /Expected exactly one/);
});

test("rejects an unparsable amount", () => {
  const tampered = challenge({ accepts: [{ ...goodOffer, amount: "not-a-number" }] });
  assert.throws(() => validateChallenge(tampered, config), /unparsable amount/);
});

test("converts atomic units without floating point drift", () => {
  assert.equal(atomicToUsdc("10000"), "0.010000");
  assert.equal(atomicToUsdc("1"), "0.000001");
  assert.equal(atomicToUsdc("1234567"), "1.234567");
});

test("decodes a base64 challenge header", () => {
  const header = Buffer.from(JSON.stringify(challenge()), "utf8").toString("base64");
  assert.equal(decodeChallengeHeader(header).x402Version, 2);
});

test("public offer exposes terms without inventing any", () => {
  assert.deepEqual(publicOffer(goodOffer), {
    scheme: "exact",
    network: "eip155:84532",
    asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    amount_atomic: "10000",
    amount_usdc: "0.010000",
    pay_to: "0x5a2324aA18613FAD4e44bDF0d6c73Ec1f6D87ff8",
    max_timeout_seconds: 60
  });
});
