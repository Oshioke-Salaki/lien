# NEAR HACKATHON submission

Nothing here has been sent. The form cannot be edited after submitting (fixes go through nearhackathon.com/request-changes), each repository can be submitted once, and the repository must be public first.

## Requirements checklist

Checked against nearhackathon.com and its HACKATHON.md on 13 November 2026. **Deadline: 14 November 2026, 23:59 UTC.** Judging runs 16 to 18 November; Claude Code and Codex screen every project first for whether it runs and does what the README says, then the human judges decide.

| Requirement | Status | Evidence |
|---|---|---|
| Code written during the window (after the 19 October announcement) | Met | First commit 4 November 2026 (`git log --reverse`) |
| Repository is public, and stays public through judging | **Not yet: the user must flip it** | github.com/Oshioke-Salaki/lien is private. Settings, Danger Zone, Change visibility |
| README says what it is and what problem it solves | Met | [README.md](../README.md), "The problem" and "What Lien does" |
| README gives reproducible "do X, see Y" steps | Met | README "Try it", [JUDGES.md](../JUDGES.md) |
| README discloses existing code, libraries and AI-generated code | Met | README "Disclosures" |
| A LICENSE file | Met | [LICENSE](../LICENSE), MIT |
| It runs and does what the README says (AI screening) | Met on the last runs | Live app [lien-five.vercel.app](https://lien-five.vercel.app); test commands in README "Test it"; live run in [evidence/testnet-e2e.md](evidence/testnet-e2e.md) |
| Demo post on X: says it was built at NEAR HACKATHON, tags @NEARProtocol and #NEARHackathon, has a video or screenshots | **Not yet: the user posts it** | Draft below |
| Form: project name | Ready | Lien |
| Form: team lead, email, team size | **The user fills these** | |
| Form: tracks, one or more | Ready | Agent Economy, Unstoppable DeFi, Autonomous Business, AI Security & Defense |
| Form: NEAR wallet address for the prize | **The user provides it** | A mainnet account; prizes are paid in NEAR within 30 days of results |
| Form: repository link | Ready | https://github.com/Oshioke-Salaki/lien |
| Form: demo post link | **After the X post** | |
| Form: "What did you build?", 20 to 2,000 characters | Ready | Below |
| Form: website (optional) | Ready | https://lien-five.vercel.app |
| Form: consent checkbox | **The user ticks it** | |
| One submission per project; up to two projects per person, each README naming the other | Met | One project |
| Testnet is eligible unless an integration is mainnet only | Met | Everything runs on testnet. NEAR Intents has no testnet, so the app shows a live mainnet quote, deposit address and status with sending switched off, plus a dry run, as HACKATHON.md suggests |

**Only the user can do these,** in this order: make the repository public; record the demo video; post it on X; then submit the form with the post link, the prize wallet, team lead, email and team size. The guest sponsor (`guests.lien-13569.testnet`) should hold enough testnet NEAR for judging: each free account costs 0.45 NEAR, plus 0.6 to start a business.

## Form answers

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

**Website:** https://lien-five.vercel.app

**You still need to provide:** team lead name, contact email, team size, a NEAR mainnet account for prizes, the X post link, and the consent tick.

## Draft X post

> Unsecured credit is crypto's biggest gap, because borrowers can walk away.
>
> AI businesses can't.
>
> I built Lien at NEAR HACKATHON: lend to an AI business with zero keys and sealed code. Stop paying and anyone can foreclose. It keeps serving customers, now earning for lenders, until it's sold.
>
> Live on testnet. No wallet needed.
> https://lien-five.vercel.app
>
> #NEARHackathon @NEARProtocol

Attach the demo video. Tag @NEARProtocol and #NEARHackathon (both required).

## Demo video plan, about two minutes

1. **The problem, 15s.** The hero. "Lend to AI. Repossess it."
2. **The trust, 25s.** Sentinel's Check it yourself panel turning Verified. Zero keys, and the TDX quote.
3. **A sale, 25s.** Buy a check, watch the report arrive and the waterfall split.
4. **The moment, 40s.** A business past grace. Press Foreclose as a stranger. Notice of foreclosure. Buy a check from it again: same address, still working, operator locked out.
5. **The sale, 15s.** A bid, and control changes hands.
6. **Close, 10s.** Evidence file and repository.
