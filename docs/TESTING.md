# What has been verified

Everything here was run. Where something has not been verified, it says so.

| Suite | Count | What it proves | Command |
|---|---|---|---|
| Contract unit and property tests | 146 | Every rule, refusal and money path, plus conservation under random inputs | `cargo test -p lien-agent` |
| Sandbox lifecycles | 17 | Real cross-contract calls on a local NEAR node with a stand-in for OutLayer | `cargo test --release -p lien-integration-tests` |
| Agent tests | 11 | Risk rules and the output format the contract parses | `cd agents/sentinel && cargo test` |
| App logic | 163 | Money math against the Rust cases, formatting, the books (income, balance sheet, customers, loans) computed from fixture views, accounts, reading outcomes, merging positions reads, the MCP server, NEAR Intents quote requests and status wording, Sentinel's risk rules ported to TypeScript (the Rust cases repeated), the ALLOW / WARN / BLOCK gate on every money-moving MCP tool, the Agent Market worker (webhook signature, brief parsing, the deliverable, start and submit against a mocked marketplace, both routes called as Next calls them) | `cd web && npm test` |
| Lender agent | 9 | The lender's policy (lend, decline with every reason, skip), WARN acknowledged only on listed flags, and the guarded signer refusing any transaction that differs from what the agent decided | `cd agents/lender && npm test` |
| Browser, read-only | 22 | Real app on real testnet: pages, the landing agreeing with the app to the cent, a business's books agreeing with /api/market to the cent and equal to its balance, live proofs, no sideways scrolling, a live Intents quote with a real deposit address and its status, the Intents dry run | `npx playwright test readonly` |
| Browser, full loan | 1 | Guest → business → loan → job → refund → claim → foreclosure → still serving → redemption | `npx playwright test lifecycle` |
| Browser, sale | 1 | Two separate users: default, foreclosure by a stranger, bid, sale, control changes hands, lender collects | `npx playwright test sale` |
| Live network run | 1 | The full lifecycle with real OutLayer. See [evidence](evidence/testnet-e2e.md) | `npm run e2e` in `ops` |
| Live agent runs | 4 | The lender agent on testnet through MCP: a hire of Sentinel, a lend, a decline, a collection with a function-call key, a foreclosure; and the prompt-injection demo. See [evidence](evidence/testnet-e2e.md#an-autonomous-lender-agent-hires-sentinel-lends-collects-and-forecloses) | `npm run lender`, `npm run lender-attack` in `ops` |
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
- **The landing and the app disagreed (found by a judge):** the landing showed Sentinel at $94.47 owed and $15.53 repaid while its page showed $89.94 and $20.06. Same rounding, same chain, but the landing's figures were baked into the HTML and only replaced after its own slow RPC sweep, which a throttled node could stop. The landing now reads `/api/market`, the snapshot the app shows, shows placeholders until then, and a browser test checks the two agree to the cent.

## Verified live, by hand

- A job through the real contract and real OutLayer, with an Intel TDX quote naming the pinned build.
- An encrypted secret stored by a contract, decrypted in the enclave and reaching the pinned build. The fake key produced `verdict_error: model_unavailable`, and the job still delivered.
- A vendor with no token account: the job completed, and the payment stayed as a credit.
- The keeper, in one-shot mode.

## Not verified

- A NEAR AI verdict with a real key, which needs a funded NEAR AI account.
- Anything on mainnet, including a real NEAR Intents payment reaching an inbox. The route, price, deposit address and `PENDING_DEPOSIT` status are real; the later statuses are shown only in the dry run and unit tests. The receiving side is tested with a plain transfer, which is what an Intents payout looks like according to its docs.
- Signing with each wallet in NEAR Connect. Browser tests sign with the guest key.
- An independent audit or load testing.
- The `transfer_note`, `propose_change` and `approve_change` flows through the UI. The contract rules are unit-tested.

The numbers stated on the site are checked against the test runners by `scripts/check-facts.mjs`.
