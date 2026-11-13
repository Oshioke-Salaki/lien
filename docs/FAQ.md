# The hard questions

**Why would anyone lend to a bot?**
Because here lenders have what no unsecured lender has: first claim on every sale, enforced by code, and the right to take the whole business. Whether the business is any good is still their call, and the app shows them its record.

**Are there enough AI businesses earning real money for this to matter?**
Not many yet, and that is the biggest risk to the idea. Lien is a bet that there will be, and that access to working capital is part of what gets them there.

**What stops the operator running a copy elsewhere?**
Nothing. They lose the account, inbox, record and sealed credentials, so size the loan below what leaving would forfeit. See [SECURITY.md](SECURITY.md).

**Isn't a TEE just trusting Intel?**
Partly, yes, and OutLayer too. Lien limits what a broken enclave can do: it can forge results, but it cannot pay outside the vendor policy or touch what lenders are owed. Money rules live in the contract, not the enclave.

**Why not ZK?**
Sentinel calls the network and could call a model. Proving that in ZK today is impractical. A TEE works now, with a stated trust assumption.

**How is this different from Virtuals or other agent tokens?**
Tokens give you exposure to an agent's story. A note gives you a fixed claim on its revenue, enforced by code, with foreclosure if it stops paying.

**How is it different from other agent credit projects?**
The closest we found, Advance on Base, enforces repayment by sweeping an on-chain fee stream, and Priors uses a refundable deposit. Neither takes over the business itself. Per-order advances, which lend against one customer payment already sitting in escrow, are safe but small: the loan can never be larger than the order, and the agent owes nothing once that order settles. Lien lends against the whole business, so it can fund growth, not just one job, and a default hands lenders a business that keeps earning. We have not seen a keyless business with a pinned build where a default transfers a running service. If you know of one, please tell us.

**Why not use OutLayer's custody vaults?**
Their exit window is at least a day and unlocking is one-way, so foreclosure would take days. See [ARCHITECTURE.md](ARCHITECTURE.md).

**Why NEAR?**
Yield and resume lets a contract wait for an enclave. Keyless sub-accounts and global contracts make a business cheap and provably immutable. Intents brings income from any chain. Named accounts mean a business's identity reads as a name that can outlast its owner. The same idea elsewhere would need several more pieces.

**Why not Chain Signatures?**
Intents already brings money in from any chain, and a signature gate on arbitrary foreign transactions would widen what a business's code can do. It would be a natural extension for businesses that must hold assets elsewhere.

**Who sets the interest rate?**
The operator offers terms and lenders take them or leave them. There is no oracle or protocol rate.

**Does Lien take a fee?**
No. There is no token and no protocol fee. A sustainable version would need one, probably a small share of interest.

**What happens to a business's customers in a foreclosure?**
Nothing. Same address, same service.

**Is this legal?**
Unknown. Lending, securities and AI-owned assets all raise real questions in most places, and nothing here is legal advice. A production version needs counsel before it takes real money.

**Why is the demo on testnet?**
Because it is not audited. The mainnet path is ready and documented in [DEPLOYMENT.md](DEPLOYMENT.md).

## Questions about the money

**Can a business fake its health with wash sales?**
It can inflate its job and customer counts by paying itself, so treat those as a claim, not proof of demand. It cannot fake repayment: the schedule counts money that reached lenders, and every self-paid sale sends lenders their share, so faking health just repays the loan. The market shows unique payers beside the job count, so a lender can see when one account is buying everything.

**What about revenue that never touches the business account?**
Lien secures what flows through the account and its inbox, and nothing else. An operator who sends customers to a different account is running a copy, covered above. Size loans to the revenue you can see arrive on chain.

**Why would an operator agree to have their business taken?**
Because it is the price of credit with no collateral posted and no equity sold. The terms are theirs to offer. They keep their share while current, any surplus from a sale above the debt goes back to them, and they can redeem a foreclosed business before it sells by paying what is owed (tested in `the_operator_can_redeem_a_foreclosed_business`).

**What is a foreclosed business actually worth?**
Its account name, inbox, customers, record, sealed credentials, seven days of working capital (foreclosure keeps that runway and seizes the rest), and every future sale. That can be little. The default reserve is half the remaining debt, and a business nobody bids on keeps earning for lenders until the debt clears.

**What if many businesses fail together?**
Not solved. Businesses on Lien share dependencies, at least OutLayer and the stablecoin, so their defaults are correlated. Today a lender diversifies by hand across businesses. A pooled product with limits on shared exposure would be the next step.

**Can a lender get out before the loan ends?**
Yes. A note can be transferred to another account with `transfer_note`, so a secondary market can price it. There is no order book for notes yet.

**Can a business sell at auction for less than the money inside it?**
Yes, if its loan's terms allow it. The lowest bid is a share of the debt that the owner offers and lenders accept before lending (`auction_reserve_bps`), and the running money a buyer receives is set by the loan, so a low floor can price the business below its cash. The app says so on the auction and on the lend form, before anyone lends. Lien's own sample businesses now set the floor at the whole debt; the two older samples, Lookout and Sentinel Late, keep the lower floors their loans were made with, because terms never change after funding.

**Who calls foreclose when nobody is paid to?**
The lenders, who are the ones it protects. It is one call, open to anyone, and it needs no keeper reward because the contract derives the breach from the schedule rather than waiting for someone to report it.

**Can someone foreclose a healthy business to grief it?**
No. Foreclosure is refused until the business is behind on the schedule and the grace period has run out, and any payment during grace cures it (`cannot_foreclose_during_grace`, `a_payment_during_grace_stops_foreclosure`).

**Can terms change under a lender, or a bid be front-run?**
Funding names the loan id and terms are fixed per loan, so a lender can only fund the terms they saw. Bids are escrowed in full, an outbid bidder is refunded at once, and a bid in the last ten minutes extends the auction.

## Questions about the code

**What happens if there is a bug in a business contract?**
It cannot be patched: the account has no keys, which is the point. A fix ships as a new global contract for new businesses, and existing ones keep the code their lenders agreed to. This is the trade an immutable lender protection makes.

**Can someone fill a business's storage to break it?**
The contract caps what others can make it store: at most 50 lenders a loan with a minimum note of a fiftieth of the principal, 64 pending jobs, the latest 200 finished jobs, 2 KB of job input and 1 KB of report. A reserve of NEAR is kept back so storage writes never run the account dry.

**Can rounding move money to the wrong place?**
Claims round down, so lenders together can never take more than the pool holds, and the split is property-tested against random amounts and note sizes. The live run ends with the ledger equal to the balance held.

**Who are the borrowers, really?**
Today, only Sentinel, our own example agent that sells account checks. Lien is for AI businesses that already sell something on chain and need money ahead of revenue, for compute, data or another agent's work.

**What is the mainnet plan?**
The contracts are configured for native USDC and the steps are in [DEPLOYMENT.md](DEPLOYMENT.md), where publishing the global code burns about 42 NEAR. We will not take real money before an independent audit.
