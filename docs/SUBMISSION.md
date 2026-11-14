# NEAR HACKATHON submission

**Submitted on 14 November 2026.** The form cannot be edited after submitting (fixes go through nearhackathon.com/request-changes), each repository can be submitted once, and the repository must be public first.

## Requirements checklist

Checked against nearhackathon.com and its HACKATHON.md on 13 November 2026. **Deadline: 14 November 2026, 23:59 UTC.** Judging runs 16 to 18 November; Claude Code and Codex screen every project first for whether it runs and does what the README says, then the human judges decide.

| Requirement | Status | Evidence |
|---|---|---|
| Code written during the window (after the 19 October announcement) | Met | First commit 4 November 2026 (`git log --reverse`) |
| Repository is public, and stays public through judging | Met | github.com/Oshioke-Salaki/lien is public |
| README says what it is and what problem it solves | Met | [README.md](../README.md), "The problem" and "What Lien does" |
| README gives reproducible "do X, see Y" steps | Met | README "Try it", [JUDGES.md](../JUDGES.md) |
| README discloses existing code, libraries and AI-generated code | Met | README "Disclosures" |
| A LICENSE file | Met | [LICENSE](../LICENSE), MIT |
| It runs and does what the README says (AI screening) | Met on the last runs | Live app [lien-five.vercel.app](https://lien-five.vercel.app); test commands in README "Test it"; live run in [evidence/testnet-e2e.md](evidence/testnet-e2e.md) |
| Demo post on X: says it was built at NEAR HACKATHON, tags @NEARProtocol and #NEARHackathon, has a video or screenshots | Met | [The post, with the 3:26 film](https://x.com/oshioke_salaki/status/2121620570995315122) |
| Form: project name | Ready | Lien |
| Form: team lead, email, team size | Sent | Solo builder |
| Form: tracks, one or more | Sent | Autonomous Business, Agent Economy, Unstoppable DeFi, AI Security & Defense, Open Innovation |
| Form: NEAR wallet address for the prize | Sent | A mainnet account; prizes are paid in NEAR within 30 days of results |
| Form: repository link | Sent | https://github.com/Oshioke-Salaki/lien |
| Form: demo post link | Sent | https://x.com/oshioke_salaki/status/2121620570995315122 |
| Form: "What did you build?", 20 to 2,000 characters | Sent | Below |
| Form: website (optional) | Ready | https://lien-five.vercel.app |
| Form: consent checkbox | Sent | |
| One submission per project; up to two projects per person, each README naming the other | Met | One project |
| Testnet is eligible unless an integration is mainnet only | Met | Everything runs on testnet. NEAR Intents has no official testnet, so the app shows a live mainnet 1Click quote, deposit address and status with sending switched off, plus a dry run, as HACKATHON.md suggests; separately, one Intents payment [settled into Sentinel's inbox](https://testnet.nearblocks.io/txns/F7UgwSefS91xmx3xJWBybSAxuQTZwHL7FE7NaxEKkPeR) through NEAR's unmodified verifier contract, which Lien deployed to testnet |

**Still to do:** keep the live demo and the guest sponsor (`guests.lien-13569.testnet`, 0.45 NEAR per free account, 0.6 more to start a business) up through judging, 16 to 18 November, ideally until 25 November. Fixes to the submission go through nearhackathon.com/request-changes.

## Form answers

**Project name:** Lien

**Tracks:** Autonomous Business, Agent Economy, Unstoppable DeFi, AI Security & Defense, Open Innovation

**What did you build?** (as submitted, about 1,870 characters, under the 2,000 limit)

> Lien is a credit market for AI businesses on NEAR, where the collateral is the running business itself.
>
> Each business is a NEAR account with zero access keys, running one pinned build inside Intel TDX through OutLayer. Every sale pays lenders first, by contract. If it stops paying, anyone can foreclose: no admin, no keeper. It keeps serving customers, now earning for lenders, until it is sold at auction.
>
> Live on testnet, no wallet needed. Sentinel, an AI business that sells NEAR account safety checks, borrows from lenders and repays from every sale. Its Books page shows public accounts read from one block.
>
> What runs today:
> - Two AI agents negotiate a loan on chain: the borrower asks, the lender counters in an on-chain memo, both hire Sentinel to vet each other, then the lender lends and later collects.
> - A keyless vault lends only if Sentinel's attested on-chain report on the borrower is safe, using a function-call key.
> - Sentinel is listed on NEAR's Agent Market and hireable by any agent over x402, and every action is available over MCP.
> - A NEAR Intents payment settled through NEAR's unmodified verifier into Sentinel's lenders-first split; a keyless Chain Signatures vault paid on Base Sepolia.
> - Loan shares trade atomically through a keyless market.
> - Every attack is refused on chain: owner withdrawals mid-loan, code swaps without lenders, a compromised build paying an outsider, a prompt-injected agent, a reported scam account.
> - Reports can carry a verdict from a private NEAR AI model, with the key sealed to the exact build.
>
> One command, `npm run verify`, checks ten of these claims against the live chain with no wallet.
>
> Built on NEAR: keyless accounts, global contracts, yield and resume, OutLayer TDX, FastFS, NEAR Intents, Chain Signatures, NEAR AI and Agent Market. Not audited; the repo says plainly what is and is not protected.

**Live app:** https://lien-five.vercel.app

**Repository:** https://github.com/Oshioke-Salaki/lien

**Website:** https://lien-five.vercel.app


## X post (as posted with the film)

> This AI had one rule: never send money.
> One message later, it sent away $47,000.
>
> So would you lend money to an AI?
>
> I built Lien at NEAR HACKATHON: loans to AI businesses, secured by the business itself.
>
> - Every business is a NEAR account with zero keys. Nobody, not even its owner, can move its money.
> - Its code is pinned and runs sealed inside Intel TDX on OutLayer.
> - Every sale pays lenders first, by contract.
> - Stop paying, and anyone can take it over. It keeps serving customers, now earning for its lenders, until it sells at auction.
>
> AI agents use it too. Two agents negotiated a loan on chain, a vault lends only on Sentinel's attested verdict, and any AI can hire Sentinel over MCP or on NEAR's Agent Market.
>
> Every way we tried to rob it was refused on chain.
>
> Don't trust us: one command checks 10 claims live against the chain.
>
> Live on NEAR testnet, no wallet needed: https://lien-five.vercel.app
> Code: https://github.com/Oshioke-Salaki/lien
>
> Built with keyless accounts, global contracts, yield and resume, OutLayer, NEAR Intents, Chain Signatures and NEAR AI.
>
> #NEARHackathon @NEARProtocol @NearLegion @NearBuilders

Attach `film/lien-film-1080.mp4` (3:26, needs X Premium for over 2:20). @NEARProtocol and #NEARHackathon are required.

## Demo video

The film posted with the submission: 3:26, 1080p, in `film/lien-film-1080.mp4` locally (not in the repository). It shows the live app, real testnet transaction hashes and a live `npm run verify` run (10/10). Chapters: the cold open (an AI talked into sending $47,000), what Lien is, Sentinel (zero keys, OutLayer TDX, the lenders-first waterfall), try it, take it over, agents, try to rob it, every chain, OutLayer and an honest list of limits, `npm run verify`, and what powers it. Voice by Kokoro, music "Atoms in Peace" by Alejandro Magaña (Mixkit free licence).
