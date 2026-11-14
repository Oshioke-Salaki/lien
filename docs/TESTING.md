# What has been verified

Everything here was run. Where something has not been verified, it says so.

| Suite | Count | What it proves | Command |
|---|---|---|---|
| Contract unit and property tests | 146 | Every rule, refusal and money path, plus conservation under random inputs | `cargo test -p lien-agent` |
| Sandbox lifecycles | 17 | Real cross-contract calls on a local NEAR node with a stand-in for OutLayer | `cargo test --release -p lien-integration-tests --test lifecycle` |
| Note market | 32 | 31 unit tests (list, confirm, buy, cancel, a wrong price, a wrong token, an unlisted or unconfirmed note, a double buy, a note transfer the business refuses refunding the buyer, a refused payout kept as a credit, a stale listing) and 1 sandbox test against a real business and token: an atomic sale, a buy refused by the business (vote-locked buyer) refunded in full, a forged callback refused, a cancel | `cargo test -p lien-notemarket`; `cargo test --release -p lien-integration-tests --test notemarket` |
| Agent tests | 11 | Risk rules and the output format the contract parses | `cd agents/sentinel && cargo test` |
| App logic | 186 | Money math against the Rust cases, formatting, the market's one listing rule and staged demo loans counted apart from real ones, display names for same-named businesses, refund addresses checked per chain, the books (income, balance sheet, customers, loans) computed from fixture views, accounts, reading outcomes, merging positions reads, the MCP server, NEAR Intents quote requests and status wording, Sentinel's risk rules ported to TypeScript (the Rust cases repeated), the ALLOW / WARN / BLOCK gate on every money-moving MCP tool, the Agent Market worker (webhook signature, brief parsing, the deliverable, start and submit against a mocked marketplace, both routes called as Next calls them), the note market tools (listing order, exact-price buy, refusals) | `cd web && npm test` |
| Lender agent | 13 | The lender's policy (lend, decline with every reason, skip), WARN acknowledged only on listed flags, counter-offers only when price alone falls short (and the countered terms then pass), the counter memo format, and the guarded signer refusing any transaction that differs from what the agent decided, counters included | `cd agents/lender && npm test` |
| Borrower agent | 5 | The borrower's answer to a counter: accepted inside its limits with only the price changed, refused with every reason when it is above its limits, the lender is not ALLOWed or cannot back it; the lender's counter to its opening offer, once accepted, passes the lender's policy; repayments follow the schedule | `cd agents/borrower && npm test` |
| Browser, read-only | 22 | Real app on real testnet: pages, the landing agreeing with the app to the cent, a business's books agreeing with /api/market to the cent and equal to its balance, live proofs, no sideways scrolling, a live Intents quote with a real deposit address and its status, the Intents preview (dry run) | `npx playwright test readonly` |
| Browser, full loan | 1 | Guest → business → loan → job → refund → claim → foreclosure → still serving → redemption | `npx playwright test lifecycle` |
| Browser, sale | 1 | Two separate users: default, foreclosure by a stranger, bid, sale, control changes hands, lender collects | `npx playwright test sale` |
| Live network run | 1 | The full lifecycle with real OutLayer. See [evidence](evidence/testnet-e2e.md) | `npm run e2e` in `ops` |
| Live agent runs | 6 | The lender agent on testnet through MCP: a hire of Sentinel, a lend, a decline, a collection with a function-call key, a foreclosure; the prompt-injection demo; a negotiation between the lender and borrower agents (offer, on-chain counter, re-offer, lend, spend on Sentinel, repay, collect, see [evidence](evidence/testnet-e2e.md#two-agents-negotiate-a-loan-and-money-moves-through-three-agents)); and a dry run against the public server that plans one hire and one lend. See [evidence](evidence/testnet-e2e.md#an-autonomous-lender-agent-hires-sentinel-lends-collects-and-forecloses) | `npm run lender`, `npm run lender-attack`, `npm run borrower`, `npm run negotiation-demo` in `ops` |
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
- Anything on mainnet, including a 1Click payment reaching an inbox. The route, price, deposit address and `PENDING_DEPOSIT` status are real; the later statuses are shown only in the preview (a dry run) and unit tests. On testnet one Intents payment did reach Sentinel's inbox through NEAR's unmodified verifier contract, deployed by Lien (`cd ops && npm run intents-settle`, read back by `npm run verify`), but no solver or 1Click took part.
- Signing with each wallet in NEAR Connect. Browser tests sign with the guest key.
- An independent audit or load testing.
- The `transfer_note`, `propose_change` and `approve_change` flows through the UI. The contract rules are unit-tested.
- On testnet, a note buy that reaches the business and is refused there. That refund path runs in the sandbox and unit tests; the testnet run shows refunds for a wrong price and an already-sold note. The note market has no UI.

The numbers stated on the site are checked against the test runners by `scripts/check-facts.mjs`.
