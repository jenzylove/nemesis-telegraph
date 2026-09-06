# First settled Telegraph payment: the spike

This is the standalone program that made the first real x402 payment to a
Telegraph miner, kept here as reproducible evidence rather than as part of the
product. The gateway at `gateway/` is what the deployed system actually runs;
this is the smaller thing that proved the payment path worked before any
product code depended on it.

It refuses to sign anything outside the audited terms: x402 v2, Base Sepolia,
the expected USDC asset and Telegraph payee, and at most 10,000 atomic units.
Every rejection happens while refusing is still free, before a signer exists.

The settled result it produced is
[`telegraph-settled-smoke-2026-09-05.json`](../telegraph-settled-smoke-2026-09-05.json),
including the `PAYMENT-RESPONSE` envelope and the Base Sepolia settlement
transaction, which was then reverified directly against the chain.

To run it you need a funded Base Sepolia burner in `TELEGRAPH_EVM_PRIVATE_KEY`.
`npm run quote` validates the live challenge without paying; `npm run pay`
settles one real payment.
