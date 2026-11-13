# Lien in two minutes, for judges

**What it is.** Lien is a market of loans to AI businesses on NEAR. Each business is a contract account with zero access keys that runs one pinned build inside Intel TDX through OutLayer, and every sale it makes pays its lenders first. If it stops paying, anyone can foreclose: the business keeps serving its customers from the same address, now earning for lenders, until someone buys it at auction.

**Live app:** [lien-five.vercel.app](https://lien-five.vercel.app) on NEAR testnet. No wallet needed: **Use a free test account** creates a funded testnet account in your browser in about ten seconds.

## Try to rob it

Each attack is refused by the contract and proven by a test. A testnet link is given only where a real transaction exists; we ran no new transactions for this table. The same three are on [/proof](https://lien-five.vercel.app/proof).

| Attack | Result | Proven by | On testnet |
|---|---|---|---|
| The operator tries to withdraw the business's money during a loan | **Refused**: "not allowed while a loan is open". The account has zero keys, so nobody can sign for it either | `the_operator_cannot_reach_the_money_during_a_loan` in `tests/integration/tests/lifecycle.rs` (also tries `update_service`, `withdraw_tank` and `create_offer`, and checks the balance is untouched) | The live run recorded `withdraw_opex refused` ([evidence](docs/evidence/testnet-e2e.md#the-operator-tries-to-take-the-money)) but kept no hash for it, so the refusal is proven by the test. Zero keys: [creation tx](https://testnet.nearblocks.io/txns/7zfvSeZ3idNUK1gxAtyP4hCLNLA4H1yAkNhT6SfdgUMc) |
| Compromised code tries to pay someone outside the spend policy | **Refused**: each such payment is skipped and counted in `spends_blocked`; only approved vendors, within per-payment and daily limits, are paid | `compromised_code_cannot_pay_anyone_outside_the_policy` (sandbox), `compromised_code_cannot_pay_the_operator` (`contracts/agent/src/tests.rs`) | No blocked payment has happened on testnet: proven by the tests |
| Someone swaps the code mid-loan without lender approval | **Refused**: "not allowed while a loan is open". During a loan a new build applies only when lenders holding more than half the loan approve | `operator_cannot_change_the_code_during_a_loan`, `a_change_applies_only_when_more_than_half_of_principal_agrees` (`contracts/agent/src/tests.rs`) | The refusal is proven by the tests. The approved path happened live: [owner proposes](https://testnet.nearblocks.io/txns/9X2VEWuuNSmNfkwDyQRSKDyy48VthqZ2uQNNtVt7crmv), [majority lender approves](https://testnet.nearblocks.io/txns/5iG4UPPizMQvJuEkeT8yE4ChTC15KnvkagJzLMYSEyAg) |

Run them:

```bash
cargo test -p lien-agent operator_cannot_change_the_code_during_a_loan
cargo test -p lien-agent compromised_code_cannot_pay_the_operator
./scripts/build.sh && cargo test --release -p lien-integration-tests --test lifecycle the_operator_cannot_reach_the_money
./scripts/build.sh && cargo test --release -p lien-integration-tests --test lifecycle compromised_code_cannot_pay_anyone
```

## By track

| Track | What to look at | Run or open this |
|---|---|---|
| **Autonomous Business** | **Sentinel, a company of none that borrows.** A contract account with zero keys that sells NEAR account safety checks, runs its pinned build in Intel TDX, pays its lenders first from every sale and pays its data vendor only within its policy. On 14 November 2026 it was repaying a $100 loan from two lenders out of its sales, and a scheduled job buys a check from it every three hours | `npm run verify` at the repo root, then [/b/sentinel.v1.lien-13569.testnet](https://lien-five.vercel.app/b/sentinel.v1.lien-13569.testnet) and the [heartbeat runs](https://github.com/Oshioke-Salaki/lien/actions/workflows/heartbeat.yml) |
| **Agent Economy** | Agents use Lien as tools over MCP: list the market, then lend, buy, repay, bid or foreclose. Every action returns an unsigned transaction the agent signs with its own key | `curl -s -X POST https://lien-five.vercel.app/api/mcp -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'`, and [an MCP-built lend, signed by the lender](https://testnet.nearblocks.io/txns/Ekqhm3JQNbtoxqDTN37Q8nLWD8HxFWvudoajQLb3sV3D) |
| **Unstoppable DeFi** | No keeper or admin: once the schedule says so, any account can foreclose, the business keeps earning for lenders, and anyone can settle the auction | [A stranger forecloses](https://testnet.nearblocks.io/txns/74LFQQGHTSo9v7uLB8u6qgMR5UTqFXJMw1fgqPLN9a3g), then [/market](https://lien-five.vercel.app/market), a business marked **Can be taken over**, **Take over this business**; `cargo test -p lien-agent anyone_can_foreclose_after_grace` |
| **AI Security & Defense** | Even compromised code can pay only approved vendors within limits and cannot reach what lenders are owed: zero keys, a pinned build, a spend policy and lender-approved changes. Sentinel itself sells security checks of NEAR accounts | [/proof](https://lien-five.vercel.app/proof) (**Try to rob it**, then five live checks in your browser), and the tests in the table above |

## Try it: do this, see this

| Do this | You should see |
|---|---|
| Run `npm run verify` at the repository root (Node 22+, nothing to install, no wallet) | Six ✅ lines read from testnet: zero keys on Sentinel and its inbox, the published contract, the pinned build re-hashed from FastFS, tokens held covering the ledger (equal when we ran it), the latest TDX quote naming the pinned build, and the recorded operator refusal |
| Open [/market](https://lien-five.vercel.app/market) | Every business listed on `v1.lien-13569.testnet`, read live: featured businesses first (the team's samples and any with three or more customers), the ones needing attention at the top, and the rest folded under **Started by visitors**. Featured plus visitors' equals the business count on the landing page and `stats.businesses` in [/api/market](https://lien-five.vercel.app/api/market); **Checks sold** equals the landing page's sales count and `stats.checksSold` |
| Click **Use a free test account** | 500.00 tUSD in the sidebar within about ten seconds |
| Open **Sentinel**, read **Check it yourself** | Five checks turn Verified, run by your browser: zero keys, the published contract, the build's bytes re-hashed, books equal balance, an Intel TDX quote naming the pinned build |
| On Sentinel, buy a check on `outlayer.testnet` | A risk report about 15 seconds later, and the waterfall bar showing what reached lenders |
| Buy a check on `hello` | A refund: there is no account in it to check, and failed jobs never keep your money |
| Lend to **Sentinel North** | The raised amount moves, and **Your positions** lists your note |
| In the market, open a business marked **Can be taken over** and press **Take over this business** (the market always keeps one: sample businesses on a fast demo clock are restocked every three hours) | A notice of foreclosure. Buy a check from it: it still works, and the operator's share now goes to lenders |
| Open a business marked **For sale** and place a bid (an open auction is always kept available; its clock starts with the first bid) | Your bid stands. When the auction ends, anyone can complete the sale and control passes to the highest bidder |
| Start your own at [/create](https://lien-five.vercel.app/create) with **Short demo clocks** | Your own keyless business, and a full foreclosure in about ten minutes |
| Move the sliders on the [landing page](https://lien-five.vercel.app) simulator, then stop the payments | The same waterfall rule the contract runs, turning into a notice of foreclosure |
| Add `https://lien-five.vercel.app/api/mcp` as an MCP server in Claude or Cursor, ask it to list Lien businesses | The live market as tools; `prepare_lend` returns a transaction your agent signs |

## Claims and their evidence

Every transaction below is from the live run in [docs/evidence/testnet-e2e.md](docs/evidence/testnet-e2e.md). Deployed addresses are in [deployments/testnet.json](deployments/testnet.json).

| Claim | Code and tests | On testnet |
|---|---|---|
| A business holds zero access keys | `contracts/registry/src/lib.rs` `create_agent` adds no key; `a_created_business_has_no_keys_and_is_listed` | [creation tx](https://testnet.nearblocks.io/txns/7zfvSeZ3idNUK1gxAtyP4hCLNLA4H1yAkNhT6SfdgUMc) |
| The operator cannot take the loan | `loan.rs` `withdraw_opex`, `update_service` refuse while a loan is open; `the_operator_cannot_reach_the_money_during_a_loan` | Refusals recorded in the evidence file, "The operator tries to take the money" |
| Every sale pays lenders first | `math.rs` `split_inflow`, property-tested; `revenue_splits_between_lenders_operator_and_opex` | [job tx](https://testnet.nearblocks.io/txns/6NqUsdMC1iCdXTLVj65RofZU6pxwHvyV5onU6XvfWFMw) |
| Work runs in Intel TDX on the pinned build | `jobs.rs` pins the WASM hash in `request_execution` | [attestation for that job](https://testnet-api.outlayer.ai/attestations/by-tx/6NqUsdMC1iCdXTLVj65RofZU6pxwHvyV5onU6XvfWFMw) |
| Compromised code cannot pay a thief | Spend policy checked in the contract; `compromised_code_cannot_pay_anyone_outside_the_policy` | Vendor payment inside the policy in the same job |
| Income from any chain enters the waterfall | `contracts/collector`; `money_sent_to_the_collector_runs_through_the_waterfall` | [inbox transfer](https://testnet.nearblocks.io/txns/GvgawbM3qSnm46BUBPCmW5zKFz5AGnYUczKDdhrEmGr8), [forward](https://testnet.nearblocks.io/txns/FuLZrQLM9kbTbtshXiirpH2xzXXzAqeQN7xc1dAbofzP) |
| Anyone can foreclose; no keeper or admin | `loan.rs` `foreclose`; `anyone_can_foreclose_after_grace_and_the_clock_needs_no_keeper`, `cannot_foreclose_during_grace` | [stranger forecloses](https://testnet.nearblocks.io/txns/74LFQQGHTSo9v7uLB8u6qgMR5UTqFXJMw1fgqPLN9a3g) |
| A foreclosed business keeps earning for lenders | `a_foreclosed_business_keeps_earning_for_lenders` | [job after foreclosure](https://testnet.nearblocks.io/txns/Aja18SN2rgSPrcni1i7Z62xgarwS91tMYsaaPYt6dktF) |
| A sale hands over control and pays lenders first | `auction.rs` `settle_auction`; `a_settled_sale_pays_lenders_and_hands_over_the_business` | [bid](https://testnet.nearblocks.io/txns/3KHTnRxrW5RfRUVNvtCKAotv4Y6dFRTTYBtfgx6TKiwq), [settle](https://testnet.nearblocks.io/txns/3smw9TPRdYZHNiTciP4gFMVnjRb5UYmRR1KSjF4k4nMf), [new owner acts](https://testnet.nearblocks.io/txns/6oqKDRZsXon3igLyQ2qwo88gibsVPduy6YAuWwtzUGtL) |
| Last-second bids cannot snipe | `auction.rs` `ANTI_SNIPE_SECS = 600`; `a_late_bid_extends_the_auction_so_it_cannot_be_sniped` | |
| Lender votes can only narrow the policy | `validate.rs` `no_wider_policy`; `a_vote_cannot_add_a_vendor` | |
| The books balance | Claims round down, property-tested in `math.rs`; the live run compares the ledger with the token balance held | End of the live run: ledger 5,360,000, held 5,360,000 |
| AI agents can use Lien as tools, with no custody | `web/src/lib/mcp.ts` (MCP over HTTP at `/api/mcp`); action tools check state and return unsigned transactions; `web/src/lib/mcp.test.ts` | [an agent's MCP-built lend, signed by the lender](https://testnet.nearblocks.io/txns/Ekqhm3JQNbtoxqDTN37Q8nLWD8HxFWvudoajQLb3sV3D) |
| The market trades on its own | `ops/src/heartbeat.ts`, run every three hours by `.github/workflows/heartbeat.yml`; it only buys work | [Actions runs, each with its transaction](https://github.com/Oshioke-Salaki/lien/actions/workflows/heartbeat.yml), and the first one by hand: [check bought](https://testnet.nearblocks.io/txns/7maVd9fJ5QPk1QtFAbi2HFKxsCMbrWDgLWtSoWpyaAzN) |
| A sealed business changes code only with lender approval | `governance.rs` `propose_change`/`approve_change`; `operator_cannot_change_the_code_during_a_loan`, `a_change_applies_only_when_more_than_half_of_principal_agrees` | Sentinel moved to a more reliable build mid-loan: [owner's proposal](https://testnet.nearblocks.io/txns/9X2VEWuuNSmNfkwDyQRSKDyy48VthqZ2uQNNtVt7crmv), [majority lender's approval](https://testnet.nearblocks.io/txns/5iG4UPPizMQvJuEkeT8yE4ChTC15KnvkagJzLMYSEyAg) |

Run every suite yourself with the commands in [README.md](README.md#test-it). What each suite proves is in [docs/TESTING.md](docs/TESTING.md).

## How Lien differs from the closest entries we found

These are good projects, and Incorpr is further along than Lien: it is live on mainnet, and Lien is on testnet only. What follows describes each project as we understand it, and what Lien does differently.

| Project | What it does |
|---|---|
| Incorpr | Live on mainnet. AI companies with keyless vaults; a company can borrow against itself from one lender, and while it is pledged the holder's signing is frozen; on default the pledge is auctioned |
| Loca | Agents get advances against paid customer orders held in escrow |
| RunWay | Revenue-based working capital for human merchants, split at a keyless settlement account |
| Float | A tranched lending pool for agents |

What Lien does differently, each with its test:

- **A market of many lenders.** Up to 50 lenders fund one loan, each holding a note for their share and paid in proportion to it (`lenders_claim_in_proportion_to_their_note`, and `notes_together_never_claim_more_than_the_pool` property-tested in `math.rs`; the live run's loan had [two](https://testnet.nearblocks.io/txns/D49E1YeRZwG9K5yffDZZvXDNbbLu4cWY6xPbsB8do6Uf) [lenders](https://testnet.nearblocks.io/txns/76G9qjZQ46eZHW1g6QJowfqUy25nHiSgSLErB6SujaKg)).
- **Lenders are paid first from every sale.** Each payment runs the waterfall before the operator or working capital see it (`math.rs` `split_inflow`, property-tested; [job tx](https://testnet.nearblocks.io/txns/6NqUsdMC1iCdXTLVj65RofZU6pxwHvyV5onU6XvfWFMw)).
- **Anyone can foreclose, with no keeper or admin** (`anyone_can_foreclose_after_grace_and_the_clock_needs_no_keeper`; [a stranger forecloses](https://testnet.nearblocks.io/txns/74LFQQGHTSo9v7uLB8u6qgMR5UTqFXJMw1fgqPLN9a3g)).
- **A foreclosed business keeps earning for its lenders, then is put up for auction** (`a_foreclosed_business_keeps_earning_for_lenders`, `a_settled_sale_pays_lenders_and_hands_over_the_business`; [job after foreclosure](https://testnet.nearblocks.io/txns/Aja18SN2rgSPrcni1i7Z62xgarwS91tMYsaaPYt6dktF), [sale settled](https://testnet.nearblocks.io/txns/3smw9TPRdYZHNiTciP4gFMVnjRb5UYmRR1KSjF4k4nMf)).

Where others are ahead: Incorpr is on mainnet, and on Loca lenders compete on price, while Lien's terms are fixed by the borrower.

## Honest limits

- **Testnet only, and unaudited.** The mainnet path is documented in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md); it is not deployed.
- **An operator can run a copy elsewhere.** They lose the account, inbox, record and sealed credentials, so loans are only safe up to what leaving forfeits.
- **Revenue that never touches the business is invisible.** Lien secures what flows through the account and its inbox, nothing else.
- **We trust OutLayer and Intel TDX** for results, but a forged result still cannot pay anyone outside the vendor policy or reach what lenders are owed.
- **No real borrowers yet.** Sentinel is our own example agent, and its customers on testnet are our test accounts.
- **NEAR Intents is a quote only.** Intents has no testnet, so the app asks the mainnet 1Click API for a live route and price as a dry run, with sending switched off. No Intents payment has reached a Lien inbox; the inbox and its forwarding are tested live with a plain transfer, which is what an Intents payout looks like.
- **Chain Signatures is not used.** A business only needs to receive money from other chains, which Intents covers. Letting a keyless business sign transactions on other chains would widen what its code can do with money, past what the spend policy guards today. It would suit businesses that must hold assets elsewhere; it is not built.

Every limit has its reasoning in [docs/SECURITY.md](docs/SECURITY.md) and [docs/FAQ.md](docs/FAQ.md).
