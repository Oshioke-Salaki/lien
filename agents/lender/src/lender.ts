// An autonomous lender. Each pass it:
//   1. reads the market and its own positions through Lien's public MCP server, and nothing else;
//   2. collects repayments, and forecloses a loan of its own that is past grace, if the policy says so;
//   3. for every business raising a loan, decides to lend or decline from policy.json, with reasons;
//      before paying it hires Sentinel (another agent, through the same MCP server) to vet the
//      business's operator, and acts only on an acceptable verdict;
//   4. signs what the server prepared with its own testnet account, after guard.ts confirms the
//      transaction is exactly what it decided.
// Every decision is one JSON line in logs/lender.jsonl.
//
//   npm run lender                  one pass against the public server
//   LIEN_MCP=http://localhost:3000/api/mcp npm run lender -- --passes 3 --every 300
//   npm run lender -- --dry-run     decide and log, sign nothing

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { addFcKey, explorer, fcAccount, fcKey, fullKeyAccount, jobIdFromLogs, logger, send } from "./chain";
import { vet, type Intent, type Prepared } from "./guard";
import { Mcp } from "./mcp";
import { evaluate, fmt, units, warnAcceptable, type BusinessView, type Policy } from "./policy";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const policyText = readFileSync(join(ROOT, "policy.json"), "utf8");
export const policy = JSON.parse(policyText) as Policy;
const policyHash = createHash("sha256").update(policyText).digest("hex").slice(0, 16);
export const ME = process.env.LENDER_ACCOUNT ?? (JSON.parse(readFileSync(join(ROOT, "agent.json"), "utf8")) as { account: string }).account;
export const MCP_URL = process.env.LIEN_MCP ?? "https://lien-five.vercel.app/api/mcp";
const DRY = process.argv.includes("--dry-run");
const arg = (name: string, fallback: number) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? Number(process.argv[i + 1]) : fallback;
};
const NEEDED_TOOLS = ["list_businesses", "get_business", "get_positions", "check_account", "prepare_lend", "prepare_hire_check", "get_check", "prepare_claim", "prepare_foreclose"];
const FC_ALLOWANCE = 5n * 10n ** 23n; // 0.5 NEAR, for gas only: covers the 300 Tgas prepaid on a claim

type Log = ReturnType<typeof logger>;

export type PayOutcome = { ok: true; tx: string; logs: string[]; gate: unknown } | { ok: false; reason: string; gate?: unknown };

/** Prepare through MCP, acknowledge a WARN only on accepted flags, check the transaction, sign it. */
export async function gatedPay(mcp: Mcp, log: Log, tool: string, args: Record<string, unknown>, intent: Intent & { kind: "pay" }): Promise<PayOutcome & { prepared?: Prepared }> {
  let out = await mcp.call(tool, args);
  const held = out.data?.gate;
  if (!out.ok && held?.verdict === "WARN") {
    if (!warnAcceptable({ verdict: "WARN", flags: held.risk.flags }, policy)) {
      log({ kind: "gate", tool, target: intent.business, verdict: "WARN", acknowledged: false, reason: held.reason });
      return { ok: false, reason: `WARN on ${intent.business} with flags outside policy: ${held.risk.flags.join(", ")}`, gate: held };
    }
    log({ kind: "gate", tool, target: intent.business, verdict: "WARN", acknowledged: true, flags: held.risk.flags, why: "every flag is on the policy's accept_warn_flags list" });
    out = await mcp.call(tool, { ...args, acknowledge_risk: true });
  }
  if (!out.ok) {
    log({ kind: "gate", tool, target: intent.business, verdict: out.data?.gate?.verdict ?? "error", refused: true, reason: out.text });
    return { ok: false, reason: out.text, gate: out.data?.gate };
  }
  const prepared = out.data as Prepared & { gate: unknown };
  const problems = vet(prepared, intent, ME, policy);
  if (problems.length) {
    log({ kind: "guard", tool, target: intent.business, signed: false, problems });
    return { ok: false, reason: `guard refused to sign: ${problems.join("; ")}`, gate: prepared.gate };
  }
  if (DRY) return { ok: false, reason: "dry run: not signed", gate: prepared.gate };
  const sent = await send(fullKeyAccount(ME), prepared);
  if (!sent.ok || sent.failedOn.includes(intent.business)) {
    return { ok: false, reason: `transaction ${sent.tx} failed: ${sent.failure ?? `refused by ${intent.business}, refunded`}`, gate: prepared.gate };
  }
  return { ok: true, tx: sent.tx, logs: sent.logs, gate: prepared.gate, prepared };
}

/** Hire Sentinel to vet an account, then wait for its attested answer. */
export async function hireSentinel(mcp: Mcp, log: Log, target: string, priceUnits: bigint, why: string) {
  const sentinel = `sentinel.${policy.registry}`;
  const paid = await gatedPay(mcp, log, "prepare_hire_check", { buyer: ME, target, business: sentinel }, { kind: "pay", business: sentinel, units: priceUnits, msg: { action: "job", input: `check ${target}` } });
  if (!paid.ok) return { ok: false as const, reason: paid.reason };
  const jobId = jobIdFromLogs(paid.logs);
  log({ kind: "hire", agent_hired: sentinel, target, why, paid: fmt(priceUnits), job_id: jobId, tx: paid.tx, explorer: explorer(paid.tx) });
  if (jobId === null) return { ok: false as const, reason: `no job id in the logs of ${paid.tx}`, tx: paid.tx };
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 8_000));
    const check = await mcp.call("get_check", { business: sentinel, job_id: jobId });
    if (!check.ok) continue;
    if (check.data.status === "Done") return { ok: true as const, tx: paid.tx, jobId, verdict: check.data.verdict as string, report: check.data.report };
    if (check.data.status === "Refunded") return { ok: false as const, reason: `Sentinel could not finish job ${jobId}; the fee was refunded`, tx: paid.tx, jobId };
  }
  return { ok: false as const, reason: `job ${jobId} still running after 4 minutes`, tx: paid.tx, jobId };
}

/** A zero-deposit call (claim or foreclose), signed with the function-call key when the agent has one. */
async function call(mcp: Mcp, log: Log, tool: string, args: Record<string, unknown>, intent: Intent & { kind: "call" }) {
  const out = await mcp.call(tool, args);
  if (!out.ok) return { ok: false as const, reason: out.text };
  const problems = vet(out.data, intent, ME, policy);
  if (problems.length) {
    log({ kind: "guard", tool, target: intent.business, signed: false, problems });
    return { ok: false as const, reason: problems.join("; ") };
  }
  if (DRY) return { ok: false as const, reason: "dry run: not signed" };
  const key = fcKey(ME, intent.business);
  const scoped = key && key.methods.includes(intent.method);
  const sent = await send(scoped ? fcAccount(key) : fullKeyAccount(ME), out.data);
  const signedWith = scoped ? `function-call key ${key.public_key} (only ${key.methods.join(", ")} on ${key.receiver})` : "full-access key";
  return sent.ok ? { ok: true as const, tx: sent.tx, signedWith } : { ok: false as const, reason: `transaction ${sent.tx} failed: ${sent.failure}` };
}

async function pass(mcp: Mcp, log: Log) {
  const market = await mcp.must<{ token: string; businesses: Array<{ id: string; name: string; job_price: string; loan: { id: number; state: string } | null }> }>("list_businesses");
  if (market.token !== policy.token) throw new Error(`The server names token ${market.token}, not the pinned ${policy.token}. Stopping.`);
  let { positions } = await mcp.must<{ positions: any[] }>("get_positions", { account: ME });

  // Collections first: they need no new risk.
  for (const p of positions) {
    if (policy.foreclose_when_late && p.can_foreclose_now) {
      const r = await call(mcp, log, "prepare_foreclose", { business: p.business, signer: ME }, { kind: "call", business: p.business, method: "foreclose" });
      log({ kind: "action", action: "foreclose", business: p.business, loan_id: p.loan_id, why: `behind and past grace (foreclosable since ${p.foreclosable_at}); policy foreclose_when_late`, ...r, ...(r.ok ? { explorer: explorer(r.tx) } : {}) });
    }
  }
  positions = (await mcp.must<{ positions: any[] }>("get_positions", { account: ME })).positions;
  for (const p of positions) {
    if (policy.collect && BigInt(p.claimable) > 0n) {
      const r = await call(mcp, log, "prepare_claim", { business: p.business, lender: ME, loan_id: p.loan_id }, { kind: "call", business: p.business, method: "claim", loanId: p.loan_id });
      log({ kind: "action", action: "collect", business: p.business, loan_id: p.loan_id, amount: fmt(BigInt(p.claimable)), ...r, ...(r.ok ? { explorer: explorer(r.tx) } : {}) });
    }
  }

  const open = positions.filter((p) => ["Funding", "Active", "Foreclosed"].includes(p.status));
  let exposure = open.reduce((sum, p) => sum + BigInt(p.lent) - BigInt(p.claimed), 0n);
  if (exposure < 0n) exposure = 0n;
  const held = new Set(positions.map((p) => `${p.business}:${p.loan_id}`));
  const sentinelPrice = units((market.businesses.find((b) => b.id === `sentinel.${policy.registry}`)?.job_price ?? "0.25").split(" ")[0]!);
  let hireSpent = 0n;

  for (const listed of market.businesses) {
    if (listed.loan?.state !== "Funding") {
      log({ kind: "decision", business: listed.id, name: listed.name, decision: "skip", reasons: [`not raising a loan (${listed.loan ? listed.loan.state.toLowerCase() : "no loan"})`] });
      continue;
    }
    const b = await mcp.must<BusinessView>("get_business", { business: listed.id });
    const d = evaluate(b, policy, { exposure, alreadyLent: held.has(`${b.id}:${b.loan?.id}`) });
    if (d.decision !== "lend") {
      log({ kind: "decision", business: b.id, name: b.name, decision: d.decision, reasons: d.reasons });
      continue;
    }
    const reasons = [...d.reasons];

    if (policy.operator_check === "hire") {
      if (hireSpent + sentinelPrice > units(policy.max_hire_spend_per_run)) {
        log({ kind: "decision", business: b.id, name: b.name, decision: "decline", reasons: [...reasons, "no hire budget left this run to vet the operator"] });
        continue;
      }
      hireSpent += sentinelPrice;
      const vetting = await hireSentinel(mcp, log, b.operator, sentinelPrice, `vet the operator of ${b.name} before lending`);
      if (!vetting.ok) {
        log({ kind: "decision", business: b.id, name: b.name, decision: "decline", reasons: [...reasons, `operator not vetted: ${vetting.reason}`] });
        continue;
      }
      if (!policy.operator_verdicts_ok.includes(vetting.verdict)) {
        log({ kind: "decision", business: b.id, name: b.name, decision: "decline", reasons: [...reasons, `Sentinel's verdict on the operator ${b.operator} is ${vetting.verdict} (job ${vetting.jobId})`] });
        continue;
      }
      reasons.push(`hired Sentinel (job ${vetting.jobId}, tx ${vetting.tx}): operator ${b.operator} is ${vetting.verdict}`);
    }

    const paid = await gatedPay(mcp, log, "prepare_lend", { business: b.id, lender: ME, amount: fmt(d.amount) }, { kind: "pay", business: b.id, units: d.amount, msg: { action: "fund", loan_id: b.loan!.id } });
    if (!paid.ok) {
      log({ kind: "decision", business: b.id, name: b.name, decision: "decline", reasons: [...reasons, `not sent: ${paid.reason}`] });
      continue;
    }
    exposure += d.amount;
    log({ kind: "decision", business: b.id, name: b.name, decision: "lend", amount: fmt(d.amount), reasons, gate: paid.gate, tx: paid.tx, explorer: explorer(paid.tx) });

    // Narrow its own access: later collections on this business need only a scoped key.
    if (!fcKey(ME, b.id)) {
      const added = await addFcKey(fullKeyAccount(ME), b.id, ["claim", "foreclose"], FC_ALLOWANCE);
      log({ kind: "key", action: "add_function_call_key", receiver: b.id, methods: ["claim", "foreclose"], allowance_near: "0.5", public_key: added.key.public_key, tx: added.tx, explorer: explorer(added.tx) });
    }
  }
}

async function main() {
  const run = `${new Date().toISOString().slice(0, 19)}Z`;
  const log = logger(process.env.LENDER_LOG ?? join(ROOT, "logs", "lender.jsonl"), run);
  const mcp = new Mcp(MCP_URL);
  await mcp.initialize();
  const tools = await mcp.tools();
  const missing = NEEDED_TOOLS.filter((t) => !tools.includes(t));
  if (missing.length) throw new Error(`${MCP_URL} lacks ${missing.join(", ")}. Point LIEN_MCP at a server built from this branch.`);
  log({ kind: "start", agent: ME, mcp: MCP_URL, policy_sha256: policyHash, dry_run: DRY });
  const passes = arg("--passes", 1), every = arg("--every", 300);
  for (let i = 0; i < passes; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, every * 1000));
    try {
      await pass(mcp, log);
    } catch (error) {
      log({ kind: "error", message: String(error) });
    }
  }
  log({ kind: "end" });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main();
