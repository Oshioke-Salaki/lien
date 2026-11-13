# Lien in two minutes, for judges

**What it is.** Lien is a market of loans to AI businesses on NEAR. Each business is a contract account with zero access keys that runs one pinned build inside Intel TDX through OutLayer, and every sale it makes pays its lenders first. If it stops paying, anyone can foreclose: the business keeps serving its customers from the same address, now earning for lenders, until someone buys it at auction.

**Live app:** [lien-five.vercel.app](https://lien-five.vercel.app) on NEAR testnet. No wallet needed: **Use a free test account** creates a funded testnet account in your browser in about ten seconds.

## Try it: do this, see this

| Do this | You should see |
|---|---|
| Open [/market](https://lien-five.vercel.app/market) | Four real businesses read from `v1.lien-13569.testnet`, the ones needing attention first |
| Click **Use a free test account** | 500.00 tUSD in the sidebar within about ten seconds |
| Open **Sentinel**, read **Check it yourself** | Five checks turn Verified, run by your browser: zero keys, the published contract, the build's bytes re-hashed, books equal balance, an Intel TDX quote naming the pinned build |
| On Sentinel, buy a check on `outlayer.testnet` | A risk report about 15 seconds later, and the waterfall bar showing what reached lenders |
| Buy a check on `hello` | A refund: there is no account in it to check, and failed jobs never keep your money |
| Lend to **Sentinel North** | The raised amount moves, and **Your positions** lists your note |
| Open **Sentinel Late**, press **Foreclose** once its clock has run out | A notice of foreclosure. Buy a check from it: it still works, and the operator's share now goes to lenders |
| Bid on **Sentinel Sale** | Your bid stands. When the auction ends, anyone can complete the sale and control passes to the highest bidder |
| Start your own at [/create](https://lien-five.vercel.app/create) with **Short demo clocks** | Your own keyless business, and a full foreclosure in about ten minutes |
| Move the sliders on the [landing page](https://lien-five.vercel.app) simulator, then stop the payments | The same waterfall rule the contract runs, turning into a notice of foreclosure |

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

Run every suite yourself with the commands in [README.md](README.md#test-it). What each suite proves is in [docs/TESTING.md](docs/TESTING.md).

## How Lien differs from the closest entries we found

These are good projects; the differences are in what secures the loan and what happens on default.

| Project | What it does | Where Lien differs |
|---|---|---|
| Incorpr | AI companies as NFTs with keyless vaults; an NFT can be pledged for a loan and auctioned on default | Lien repays from every sale through a waterfall, and after default the business keeps paying lenders instead of being frozen |
| Loca | Agents borrow against a customer order already in escrow; lender agents bid | An order advance is capped by the order. Lien lends against the whole running business |
| RunWay | Revenue-based working capital for human merchants, split at a keyless settlement account | Lien's borrowers are sealed AI businesses run in TDX, and a default transfers the business |
| Float | A tranched lending pool for agents | Lien is deployed and tested end to end on testnet |

## Honest limits

- **Testnet only, and unaudited.** The mainnet path is documented in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md); it is not deployed.
- **An operator can run a copy elsewhere.** They lose the account, inbox, record and sealed credentials, so loans are only safe up to what leaving forfeits.
- **Revenue that never touches the business is invisible.** Lien secures what flows through the account and its inbox, nothing else.
- **We trust OutLayer and Intel TDX** for results, but a forged result still cannot pay anyone outside the vendor policy or reach what lenders are owed.
- **No real borrowers yet.** Sentinel is our own example agent, and its customers on testnet are our test accounts.
- **NEAR Intents is mainnet only,** so the app shows a live mainnet quote with sending switched off.

Every limit has its reasoning in [docs/SECURITY.md](docs/SECURITY.md) and [docs/FAQ.md](docs/FAQ.md).
