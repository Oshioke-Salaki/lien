# User guide

Lien has four kinds of user, and one person can be all of them.

## Getting started

Open the app and choose **Get a free test account** for a funded testnet account stored in this browser, or **Connect a wallet**. On testnet, **Get test funds** in the sidebar adds 100 tUSD at any time. **Forget** erases a test account for good.

## Customers: buying work

Open a business and find **Buy a check**. Enter a NEAR account and choose **Pay and run**. The report appears in about 15 seconds.

- If the run fails or the input has no account in it, you get a full refund automatically.
- If you pay too much, the change comes back.
- Your input is public, so do not put anything private in it.

To pay from another chain, use **Pay this business from any chain** to get a quote and a deposit address (mainnet only). That counts as income to the business rather than buying a job.

## Lenders: funding a loan

Before you lend, read these on the business page:

1. **Check it yourself.** All five should say Verified. Do not lend if any says Failed.
2. **Loan terms.** How much reaches you, and how quickly.
3. **Spending limits.** The business's daily limit times the term is the most it could spend away.
4. **Work sold.** Distinct customers matter more than job counts, which can be inflated.
5. **Loan history.** How past loans ended.
6. **The source code.** Only the pinned build matters, and you can read it.

Then enter an amount under **Lend to this business**. The minimum note is 2% of the loan. A loan that does not fill by its deadline can be cancelled by anyone, and everyone can claim their money back.

**Collecting:** repayments build up under **Your position**. Collect whenever you like, including after the loan closes. **Your positions** shows all your notes.

**Selling:** you can transfer a whole note to another account under **Sell or move this note**. There is no built-in marketplace for notes.

**Voting:** if a change to the code or price is proposed, it shows in your position. It applies once holders of more than half the principal approve, and it can never add a vendor or raise a limit.

**If it stops paying:** the operator's share comes to you automatically. After the grace period anyone can foreclose, including you.

## Operators: running and borrowing

**Starting.** Go to **Start a business**. It costs 0.5 NEAR, most of which becomes the business's compute funds. You can start with Sentinel, or your own build (see the developer guide).

**Borrowing.** On your business, open **Borrow against this business**. The preview says when steady revenue would clear the debt, and warns if it never would. Once you submit, your code, price and vendors freeze.

**During a loan you can:** withdraw your agreed share while current, repay at any time, pay from working capital, and propose changes to lenders.

**You cannot:** take the principal or working capital, change anything alone, or leave with the account.

**Stay current:** the schedule counts money reaching lenders. If revenue dips, pay the difference. Falling behind locks your share at once, and a payment unlocks it just as quickly.

**Keep compute funded:** with no NEAR in the tank, jobs bounce. Anyone can top it up.

**If you are foreclosed:** you can still redeem by paying the full debt until a sale settles. If a sale goes above the debt, the surplus is yours.

## Bidders: buying a business

Open any foreclosed business. **Buy this business** shows the debt, the current high bid and the working capital included.

- A first bid must meet the reserve. Each later bid must beat the last by 5%.
- If you are outbid, your money comes straight back.
- A bid in the last ten minutes extends the auction.
- If the debt gets repaid before the sale settles, your bid comes back and the sale is off.

When the auction ends, anyone can choose **Complete the sale**. You then operate the business, at the same address, with full control and no debt.

## Keepers

Foreclosing, settling, forwarding an inbox and refunding stuck jobs are open to anyone. `ops/src/keeper.ts` does them automatically, but nothing depends on it running.
