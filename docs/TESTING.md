# What has been verified

Everything here was run. Where something has not been verified, it says so.

| Suite | Count | What it proves | Command |
|---|---|---|---|
| Contract unit and property tests | 146 | Every rule, refusal and money path, plus conservation under random inputs | `cargo test -p lien-agent` |
| Sandbox lifecycles | 17 | Real cross-contract calls on a local NEAR node with a stand-in for OutLayer | `cargo test --release -p lien-integration-tests` |
| Agent tests | 11 | Risk rules and the output format the contract parses | `cd agents/sentinel && cargo test` |
| App logic | 71 | Money math against the Rust cases, formatting, accounts, reading outcomes, merging positions reads, the MCP server | `cd web && npm test` |
| Browser, read-only | 18 | Real app on real testnet: pages, live proofs, no sideways scrolling, a live Intents quote | `npx playwright test readonly` |
| Browser, full loan | 1 | Guest → business → loan → job → refund → claim → foreclosure → still serving → redemption | `npx playwright test lifecycle` |
| Browser, sale | 1 | Two separate users: default, foreclosure by a stranger, bid, sale, control changes hands, lender collects | `npx playwright test sale` |
| Live network run | 1 | The full lifecycle with real OutLayer. See [evidence](evidence/testnet-e2e.md) | `npm run e2e` in `ops` |
| Live claim checks | 6 | Read-only, against testnet as it is now: zero keys on Sentinel and its inbox, the published contract, the pinned build re-hashed, tokens held cover the ledger, the latest TDX quote names the pinned build, and the operator refusal recorded in the evidence file. No wallet, no transactions | `npm run verify` at the root |

The money properties checked for random inputs: a split conserves every unit, notes never claim more than the pool, claiming in steps pays the same as claiming once, paying more never brings a breach forward, every unpaid loan breaches by maturity, and every valid bid increases.

## Bugs testing found

Kept here because they show what the tests are worth.

- **Double count in the first design:** reading a contract's own balance to detect income could count a transfer twice. This led to the separate inbox.
- **Failed creation listed as real:** chained promises carry on after a failure, and the callback only sees the last result. Creation now joins them and refunds exactly what failed.
- **Multi-byte AI verdicts:** a long non-English verdict could pass the 1024-byte report limit and refund every customer. Now trimmed by bytes.
- **Rounding that did not add up:** 0.07 + 0.05 + 0.12 displayed for a 0.25 sale. Figures are now exact.
- **A false claim in the UI:** a panel called the contract "audited". It is not, and now says "published".
- **Guests ready before funded:** the app showed guests signed in before their test funds arrived.
- **Faucet limits:** the public faucet allows about one account per IP every 11 hours, which would have failed for nearly every visitor. Guests now come from a sponsor.

## Verified live, by hand

- A job through the real contract and real OutLayer, with an Intel TDX quote naming the pinned build.
- An encrypted secret stored by a contract, decrypted in the enclave and reaching the pinned build. The fake key produced `verdict_error: model_unavailable`, and the job still delivered.
- A vendor with no token account: the job completed, and the payment stayed as a credit.
- The keeper, in one-shot mode.

## Not verified

- A NEAR AI verdict with a real key, which needs a funded NEAR AI account.
- Anything on mainnet, including a real NEAR Intents payment reaching an inbox. The route and price are real, and the receiving side is tested with a plain transfer, which is what an Intents payout looks like according to its docs.
- Signing with each wallet in NEAR Connect. Browser tests sign with the guest key.
- An independent audit or load testing.
- The `transfer_note`, `propose_change` and `approve_change` flows through the UI. The contract rules are unit-tested.

The numbers stated on the site are checked against the test runners by `scripts/check-facts.mjs`.
