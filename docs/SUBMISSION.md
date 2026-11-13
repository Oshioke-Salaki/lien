# NEAR HACKATHON submission draft

Nothing here has been sent. The form cannot be edited after submitting, and the repository must be public first.

**Project name:** Lien

**Tracks:** Agent Economy, Unstoppable DeFi, Autonomous Business, AI Security & Defense

**What did you build?** (under 2,000 characters)

> Unsecured credit is DeFi's big gap, because a borrower can always walk away. AI agents make it worse: they can earn, but nobody will lend to software whose owner can change it or empty its wallet tomorrow.
>
> Lien lends to AI businesses that cannot choose to skip a payment. Each business is a NEAR account with zero access keys. Its contract pins one exact WASM build, which runs in Intel TDX through OutLayer. Every sale goes through a waterfall, lenders first, and the principal can only be spent by the pinned code, to approved vendors, up to a limit. If it falls behind, anyone can foreclose. No admin, no oracle, no keeper. Then the collateral does something collateral has never done: it keeps working. The same address serves the same customers, earning for lenders, until someone buys the business at auction.
>
> It is live on testnet with a real example agent, Sentinel, which sells pre-flight checks on NEAR accounts. Try the whole loop with no wallet: a free test account lends, buys TEE work, forecloses and bids. The app's Check it yourself panel verifies everything from your browser: zero keys, the published code, the build's bytes, books against balance, and an Intel TDX quote naming the pinned build.
>
> NEAR powers all of it: yield and resume for waiting on the enclave, keyless sub-accounts and global contracts for immutable businesses, OutLayer for attested compute, FastFS for public builds, and NEAR Intents to bring income in from any chain.
>
> Not audited, and the repository says plainly what is and is not protected.

**Live app:** https://lien-five.vercel.app

**Repository:** https://github.com/Oshioke-Salaki/lien

**You still need to provide:** team lead name, contact email, team size, a NEAR mainnet account for prizes, and the X post link.

## Draft X post

> Unsecured credit is crypto's biggest gap, because borrowers can walk away.
>
> AI businesses can't.
>
> I built Lien at NEAR HACKATHON: lend to an AI business with zero keys and sealed code. Stop paying and anyone can foreclose. It keeps serving customers, now earning for lenders, until it's sold.
>
> Live on testnet. No wallet needed.
> https://lien-five.vercel.app

Attach the demo video. Mention @NEARProtocol and @NEAR_hckthn.

## Demo video plan, about two minutes

1. **The problem, 15s.** The hero. "Lend to AI. Repossess it."
2. **The trust, 25s.** Sentinel's Check it yourself panel turning Verified. Zero keys, and the TDX quote.
3. **A sale, 25s.** Buy a check, watch the report arrive and the waterfall split.
4. **The moment, 40s.** A business past grace. Press Foreclose as a stranger. Notice of foreclosure. Buy a check from it again: same address, still working, operator locked out.
5. **The sale, 15s.** A bid, and control changes hands.
6. **Close, 10s.** Evidence file and repository.
