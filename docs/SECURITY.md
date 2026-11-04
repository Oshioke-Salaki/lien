# Threat model

**Lien has not been independently audited, and should not hold real money until it has.** This page says what is protected and, just as importantly, what is not.

## What the contracts guarantee

These are tested, and do not depend on anyone behaving well.

| Attack | Why it fails |
|---|---|
| Operator withdraws the principal | `withdraw_opex` is refused with an open loan, and the account has no keys |
| Operator swaps the code after funding | The service freezes at `create_offer`. A change needs over half the principal |
| Operator pays themselves through a vendor | The operator cannot be listed as a vendor |
| Compromised code pays a thief | Anything outside the vendor list and limits is refused and logged |
| A majority of lenders drains the minority | A vote can never add a vendor or raise a limit |
| The same principal votes twice | A note that voted cannot move while that proposal is open |
| Lender claims more than earned | Claims round down, and are property-tested against the pool |
| Forged payment or forged job result | `ft_on_transfer` checks the token, and callbacks are private |
| Unpayable recipient blocks progress | Failed payouts become credits |
| A bid is sniped in the last block | A late bid extends the auction by ten minutes |
| Terms change under a lender | Funding names the loan id, and terms are fixed per loan |

## What is not protected

**Running a copy.** The code is open, so an operator can run it elsewhere and move customers there. They lose the account, the inbox, the on-chain record and the sealed credentials, so a loan is only safe up to what leaving would forfeit. Lenders must size for this. Lien makes leaving costly, not impossible.

**Sybil vendors.** An operator can list an account they secretly control as a vendor, with code that pays it. The most this can drain is the daily limit per day, for as long as the loan lasts. Over a long term that could be all the working capital. Lenders must read the limits and the code, and the build is public so they can.

**Fake activity.** Job and customer counts can be inflated by paying yourself. It cannot satisfy the repayment schedule, because that counts money to lenders, and self-dealing just repays the loan. But a lender reading those counts as demand can be fooled.

**OutLayer's operators.** The contract trusts results from `outlayer.near`. OutLayer's own docs say a full-access key on its operator account would be accepted as a worker, and that its owner approves enclave measurements alone. A dishonest or compromised OutLayer could forge results. The damage is limited to refusing or forging jobs and spends inside the policy: it cannot pay anyone off the vendor list or reach what lenders are owed.

**Enclave breaks.** Intel TDX has had and may have side-channel attacks. Same ceiling as above, plus sealed secrets could be read.

**Upstream dependencies.** An operator knows any API key they store and can revoke it at the provider. Sentinel keeps working without its model, and a business that stops earning falls behind, but a service could be degraded this way.

**Public inputs.** Job inputs are in a public transaction. Do not send anything private. Encrypting them to the enclave is possible, but not built.

**No upgrades.** Businesses are keyless, so a contract bug cannot be patched. Plain token transfers to the business itself, rather than its inbox, are not recoverable.

**Griefing with failing jobs.** A failed job refunds the customer but still costs compute from the tank. The attacker pays their own gas on each attempt, and anyone can top the tank up. An empty tank bounces payments rather than taking them, though a business with no compute will fall behind.

**Auctions with no bids.** A foreclosed business with no bidders stays in foreclosure, earning for lenders until the debt clears, when it returns to its operator. Lenders may wait a long time.

**Rate limits on guests.** The guest route's limit is per server instance, in memory. It protects free testnet NEAR only.

## Reporting

Open an issue on the repository. There is no bounty program.
