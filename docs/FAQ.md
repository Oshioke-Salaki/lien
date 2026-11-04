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
The closest we found, Advance on Base, enforces repayment by sweeping an on-chain fee stream, and Priors uses a refundable deposit. Neither takes over the business itself. We have not seen a keyless business with a pinned build where a default transfers a running service. If you know of one, please tell us.

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
