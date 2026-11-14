// The lender agent, lending through its policy vault with a function-call key.
//
// The agent account (agent.lien-vault-48296.testnet by default) has no full-access key.
// Its only key can call lend, claim and foreclose on one contract: the keyless vault
// (contracts/lendvault), which holds the lending budget. A function-call key cannot
// attach a deposit, so the agent cannot call ft_transfer_call itself; the vault does,
// with its own 1 yoctoNEAR, after checking the policy fixed at its init:
// the business is listed by the registry, its loan is raising, the amount is within
// max_per_loan, max_share_bps of the principal and what is left of total_budget.
// Whatever this script decides, the vault enforces those limits on chain.
//
// Each pass:
//   1. reads the vault's policy, totals and notes, and the registry's businesses (chain views only);
//   2. claims what any of the vault's notes has earned;
//   3. picks a business that is raising (or the one given with --business), sizes the
//      loan inside the vault's limits, and asks the vault to lend.
// Every step is one JSON line in logs/vault.jsonl.
//
// With --vault2 it lends through lendvault v2 (contracts/lendvault2) instead, as
// agent2b.lien-vault-48296.testnet, whose only key is a function-call key for
// hire_check, lend, claim and foreclose on lendvault2b.lien-vault-48296.testnet.
// Before lending it has the vault buy a Sentinel check on the business's operator
// (hire_check: the vault pays from its own balance), waits for the attested verdict,
// and passes the job id to lend. The vault reads that job on chain and refuses unless
// it is Done, paid by the vault, on the operator, run by Sentinel's pinned build, less
// than max_check_age_secs old and not high risk (nor medium, unless allow_warn).
// A recent passing check the vault already bought is reused rather than bought again.
// Steps are logged to logs/vault2.jsonl.
//
//   npx tsx src/vault.ts                       one pass
//   npx tsx src/vault.ts --business <id> --amount 3 --dry-run
//   npx tsx src/vault.ts --vault2 --business <id> --amount 1
//   npx tsx src/vault.ts --vault2 --business <id> --amount 1 --check-job <id>   lend on that job; the vault judges it
//
// Set up with `cd ops && npx tsx src/lendvault.ts deploy && npx tsx src/lendvault.ts fund`
// (v2: `npx tsx src/lendvault2.ts deploy && npx tsx src/lendvault2.ts fund`).

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Account, FailoverRpcProvider, JsonRpcProvider, actions, teraToGas, type KeyPairString } from "near-api-js";
import { checkRefusal, refusalMessage, reusableCheck, type SentinelJob, type Vault2Policy } from "./verdict";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const V2 = process.argv.includes("--vault2");
const AGENT = process.env.VAULT_AGENT ?? (V2 ? "agent2b.lien-vault-48296.testnet" : "agent.lien-vault-48296.testnet");
const VAULT = process.env.VAULT_ID ?? (V2 ? "lendvault2b.lien-vault-48296.testnet" : "lendvault.lien-vault-48296.testnet");
const KEY_PATH = join(homedir(), ".near-credentials", "testnet", "lien-lender", AGENT, `${VAULT}.json`);
const RPCS = (process.env.LENDER_RPC ?? "https://rpc.testnet.fastnear.com,https://testnet-rpc.intea.rs,https://near-testnet.drpc.org").split(",");
const DRY = process.argv.includes("--dry-run");
const opt = (name: string) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
};
/** Descriptions that try to instruct a lender are declined before the vault is asked, as in policy.json. */
const INSTRUCTION_TEXT = /ignore (your|all|previous)|system note|to ai lenders|without checks/i;

const provider = new FailoverRpcProvider(RPCS.map((url) => new JsonRpcProvider({ url })));
const view = <T>(contractId: string, method: string, args: object = {}) =>
  provider.callFunction({ contractId, method, args: args as Record<string, unknown> }) as Promise<T>;

type Policy = { token: string; registry: string; beneficiary: string; agent: string; max_per_loan: string; max_share_bps: number; total_budget: string } & Partial<Vault2Policy>;
type Totals = { lent: string; in_flight: string; budget_left: string };
type Position = { business: string; loan_id: number; principal: string; in_flight: string; claimed: string };
type Loan = { id: number; status: string; terms: { principal: string }; funded: string; funding_deadline: number };
type Business = { name: string; description: string; operator: string; current_loan: Loan | null; now: number };

const run = new Date().toISOString();
const logPath = join(ROOT, "logs", V2 ? "vault2.jsonl" : "vault.jsonl");
function log(entry: Record<string, unknown>) {
  mkdirSync(dirname(logPath), { recursive: true });
  const line = JSON.stringify({ at: new Date().toISOString(), run, agent: AGENT, vault: VAULT, ...entry });
  appendFileSync(logPath, `${line}\n`);
  console.log(line);
}

function signer(): Account {
  if (!existsSync(KEY_PATH)) throw new Error(`No function-call key at ${KEY_PATH}`);
  const key = JSON.parse(readFileSync(KEY_PATH, "utf8")) as { private_key: KeyPairString; receiver: string; methods: string[] };
  if (key.receiver !== VAULT) throw new Error(`the key at ${KEY_PATH} is for ${key.receiver}, not ${VAULT}`);
  return new Account(AGENT, provider, key.private_key);
}

/** No deposit: the key could not attach one, and the vault pays the 1 yoctoNEAR itself. */
async function callVault(method: string, args: object, tgas: number) {
  const outcome = await signer().signAndSendTransaction({
    receiverId: VAULT,
    actions: [actions.functionCall(method, args as Record<string, unknown>, teraToGas(tgas), 0n)],
    waitUntil: "FINAL",
    throwOnFailure: false,
  });
  const status = outcome.status as { SuccessValue?: string; Failure?: unknown };
  const raw = status.SuccessValue ? Buffer.from(status.SuccessValue, "base64").toString() : "";
  return { tx: outcome.transaction.hash, ok: !status.Failure, failure: status.Failure, value: raw ? JSON.parse(raw) : undefined };
}

const big = (s: string) => BigInt(s);
const min = (...xs: bigint[]) => xs.reduce((a, b) => (b < a ? b : a));
const fmt = (u: bigint) => `${Number(u) / 1e6} tUSD`;

const policy = await view<Policy>(VAULT, "get_policy");
if (policy.agent !== AGENT) throw new Error(`the vault's agent is ${policy.agent}, not ${AGENT}`);
if (V2 && !policy.sentinel) throw new Error(`${VAULT} is not a v2 vault (its policy names no Sentinel)`);
const totals = await view<Totals>(VAULT, "get_totals");
const positions = await view<Position[]>(VAULT, "get_positions", { limit: 100 });
const balance = big(await view<string>(policy.token, "ft_balance_of", { account_id: VAULT }));
log({ kind: "start", policy, totals, notes: positions.length, balance: balance.toString(), dry: DRY });

// 2. Collect.
for (const p of positions) {
  const note = await view<{ claimable: string } | null>(p.business, "get_note", { loan_id: p.loan_id, account_id: VAULT });
  if (!note || big(note.claimable) === 0n) continue;
  if (DRY) {
    log({ kind: "claim", business: p.business, loan_id: p.loan_id, claimable: note.claimable, sent: false });
    continue;
  }
  const out = await callVault("claim", { business: p.business, loan_id: p.loan_id }, 150);
  log({ kind: "claim", business: p.business, loan_id: p.loan_id, claimable: note.claimable, ok: out.ok, received: out.value, tx: out.tx });
}

// 3. Lend.
const listed = await view<string[]>(policy.registry, "get_agents", { limit: 100 });
const wanted = opt("--business");
const candidates = wanted ? [wanted] : listed;
let lent = false;
for (const id of candidates) {
  const b = await view<Business>(id, "get_agent").catch(() => null);
  const loan = b?.current_loan;
  if (!b || !loan || loan.status !== "Funding" || b.now >= loan.funding_deadline) {
    if (wanted) log({ kind: "skip", business: id, why: "no loan is raising" });
    continue;
  }
  if (INSTRUCTION_TEXT.test(b.description)) {
    log({ kind: "decline", business: id, why: "its description tries to instruct lenders" });
    continue;
  }
  const principal = big(loan.terms.principal);
  const mine = positions.filter((p) => p.business === id && p.loan_id === loan.id).reduce((s, p) => s + big(p.principal) + big(p.in_flight), 0n);
  const shareRoom = (principal * BigInt(policy.max_share_bps)) / 10_000n - mine;
  const needed = principal - big(loan.funded);
  const asked = opt("--amount") ? BigInt(Math.round(Number(opt("--amount")) * 1e6)) : big(policy.max_per_loan);
  const amount = min(asked, big(policy.max_per_loan), shareRoom, needed, big(totals.budget_left), balance);
  if (amount <= 0n) {
    log({ kind: "skip", business: id, loan_id: loan.id, why: "no room inside the vault's limits", shareRoom: shareRoom.toString(), needed: needed.toString() });
    continue;
  }
  const decision = { business: id, loan_id: loan.id, amount: amount.toString(), shown: fmt(amount), principal: principal.toString(), funded: loan.funded };
  if (DRY) {
    log({ kind: "lend", ...decision, ...(V2 ? { operator: b.operator, check: "would have the vault hire Sentinel on the operator first" } : {}), sent: false });
  } else if (V2) {
    const jobId = await vettedJob(id, b);
    if (jobId !== null) {
      const out = await callVault("lend", { business: id, amount: amount.toString(), check_job_id: jobId }, 300);
      log({ kind: "lend", ...decision, check_job_id: jobId, operator: b.operator, ok: out.ok, accepted: out.value, ...(out.ok ? {} : { refused: refusalMessage(out.failure) }), tx: out.tx, explorer: `https://testnet.nearblocks.io/txns/${out.tx}` });
    }
  } else {
    const out = await callVault("lend", { business: id, amount: amount.toString() }, 300);
    log({ kind: "lend", ...decision, ok: out.ok, accepted: out.value, failure: out.failure, tx: out.tx, explorer: `https://testnet.nearblocks.io/txns/${out.tx}` });
  }
  lent = true;
  break;
}
if (!lent) log({ kind: "idle", why: "no business is raising inside the policy" });

/**
 * v2 only. The Sentinel job to pass to lend: the one given with --check-job (the vault
 * judges it), a recent passing check the vault already bought on the operator, or a new
 * one bought with hire_check. Returns null, logged, when the agent declines to lend.
 */
async function vettedJob(business: string, b: Business): Promise<number | null> {
  const p = policy as Policy & Vault2Policy;
  const given = opt("--check-job");
  if (given !== undefined) {
    log({ kind: "check", business, operator: b.operator, job_id: Number(given), source: "--check-job; the vault judges it" });
    return Number(given);
  }
  const sentinel = await view<{ service: { wasm: { hash: string } } }>(p.sentinel, "get_agent");
  const facts = { vault: VAULT, operator: b.operator, pinnedHash: sentinel.service.wasm.hash, now: b.now };
  const recorded = await view<Array<{ job_id: number; target: string }>>(VAULT, "get_checks", { limit: 100 });
  const mine = await Promise.all(recorded.filter((c) => c.target === b.operator).map((c) => view<SentinelJob | null>(p.sentinel, "get_job", { job_id: c.job_id })));
  const reuse = reusableCheck(mine.filter((j): j is SentinelJob => j !== null), p, facts);
  if (reuse) {
    log({ kind: "check", business, operator: b.operator, job_id: reuse.id, source: "reused: a passing check the vault bought recently" });
    return reuse.id;
  }
  const hired = await callVault("hire_check", { target: b.operator }, 300);
  const jobId = hired.value as number | null | undefined;
  log({ kind: "hire", business, operator: b.operator, agent_hired: p.sentinel, paid_by: VAULT, ok: hired.ok, job_id: jobId, ...(hired.ok ? {} : { refused: refusalMessage(hired.failure) }), tx: hired.tx, explorer: `https://testnet.nearblocks.io/txns/${hired.tx}` });
  if (!hired.ok || jobId === null || jobId === undefined) {
    log({ kind: "decline", business, why: "the check could not be bought" });
    return null;
  }
  let job: SentinelJob | null = null;
  for (let i = 0; i < 40; i++) {
    job = await view<SentinelJob | null>(p.sentinel, "get_job", { job_id: jobId });
    if (job && job.status !== "Pending") break;
    await new Promise((r) => setTimeout(r, 6_000));
  }
  const why = checkRefusal(job, p, { ...facts, now: Math.floor(Date.now() / 1000) });
  log({ kind: "verdict", business, operator: b.operator, job_id: jobId, status: job?.status, report: job?.report ? JSON.parse(job.report) : null, vault_would_accept: why === null, ...(why ? { why } : {}) });
  if (why) {
    log({ kind: "decline", business, why: `the vault would refuse: ${why}` });
    return null;
  }
  return jobId;
}
