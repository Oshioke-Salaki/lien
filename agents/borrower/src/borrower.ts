// An autonomous borrower: the operator of one AI business (Courier, which sells safety
// checks of NEAR accounts). Each pass it looks at its own loan and does the next thing
// its policy says:
//   - no loan yet:   posts its opening terms (create_offer);
//   - raising:       looks for counter-offers sent to it on chain, verifies each from RPC,
//                    hires Sentinel (another agent, through MCP) to vet the lender behind
//                    it, checks the lender holds what it offers, then either cancels and
//                    re-offers on the countered terms or walks away, with reasons;
//   - active:        withdraws its earned operator share, buys a Sentinel check of its own
//                    data vendor through MCP, and repays what the schedule needs.
// It reads the market through Lien's MCP server and signs what the server prepares after
// the same guard the lender uses. Operator-only calls (create_offer, cancel_offer,
// withdraw_operator) have no MCP tool, so it builds those itself.
// Every step is one JSON line in logs/borrower.jsonl, with a tx hash for every on-chain step.
//
//   npm run borrower                  one pass against the public server
//   npm run borrower -- --passes 4 --every 60
//   npm run borrower -- --dry-run     decide and log, sign nothing

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { vet, type Intent, type Prepared } from "../../lender/src/guard";
import { Mcp } from "../../lender/src/mcp";
import { fmt, units, type Policy as LenderPolicy } from "../../lender/src/policy";
import { explorer, findCounters, keyAccount, logger, readLog, sendCalls, sendPrepared, view } from "./chain";
import { answerCounter, dueByWindowEnd, toContractTerms, type BorrowerPolicy, type ContractTerms, type Vetting } from "./terms";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const policyText = readFileSync(join(ROOT, "policy.json"), "utf8");
const policy = JSON.parse(policyText) as BorrowerPolicy;
const policyHash = createHash("sha256").update(policyText).digest("hex").slice(0, 16);
const agent = JSON.parse(readFileSync(join(ROOT, "agent.json"), "utf8")) as { account: string; business: string };
const ME = process.env.BORROWER_ACCOUNT ?? agent.account;
const BUSINESS = process.env.BORROWER_BUSINESS ?? agent.business;
const SENTINEL = `sentinel.${policy.registry}`;
const MCP_URL = process.env.LIEN_MCP ?? "https://lien-five.vercel.app/api/mcp";
const DRY = process.argv.includes("--dry-run");
const TGAS = 10n ** 12n;
const arg = (name: string, fallback: number) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? Number(process.argv[i + 1]) : fallback;
};
// The guard only reads the pinned token and registry.
const pinned = { token: policy.token, registry: policy.registry } as LenderPolicy;

type Log = ReturnType<typeof logger>;
type Business = {
  id: string;
  name: string;
  operator: string;
  loan: { id: number; state: string } | null;
  terms: (ContractTerms & { funded: string; repaid: string; activated_at: string | null }) | null;
};

/** Prepare through MCP, check the transaction against the intent, sign it. */
async function prepareAndSign(mcp: Mcp, log: Log, tool: string, args: Record<string, unknown>, intent: Intent & { kind: "pay" }) {
  const out = await mcp.call(tool, args);
  if (!out.ok) return { ok: false as const, reason: out.text };
  const problems = vet(out.data as Prepared, intent, ME, pinned);
  if (problems.length) {
    log({ kind: "guard", tool, signed: false, problems });
    return { ok: false as const, reason: `guard refused to sign: ${problems.join("; ")}` };
  }
  if (DRY) return { ok: false as const, reason: "dry run: prepared and checked, not signed" };
  const sent = await sendPrepared(keyAccount(ME), out.data as Prepared);
  if (!sent.ok || sent.failedOn.includes(intent.business)) return { ok: false as const, reason: `transaction ${sent.tx} failed: ${sent.failure ?? "refused and refunded"}` };
  return { ok: true as const, tx: sent.tx, logs: sent.logs };
}

function jobIdFromLogs(logs: string[]): number | null {
  for (const line of logs) {
    if (!line.startsWith("EVENT_JSON:")) continue;
    try {
      const e = JSON.parse(line.slice(11)) as { event?: string; data?: any };
      const d = Array.isArray(e.data) ? e.data[0] : e.data;
      if (e.event === "job_started" && typeof d?.job_id === "number") return d.job_id;
    } catch {
      /* not an event */
    }
  }
  return null;
}

/** Buys one Sentinel check of `target` and waits for the attested verdict. */
async function buyCheck(mcp: Mcp, log: Log, target: string, why: string, tool: "prepare_hire_check" | "prepare_buy_job") {
  const sentinel = await mcp.must<{ job_price: string }>("get_business", { business: SENTINEL });
  const price = units(sentinel.job_price.split(" ")[0]!);
  const args = tool === "prepare_hire_check" ? { buyer: ME, target, business: SENTINEL } : { business: SENTINEL, buyer: ME, input: `check ${target}` };
  const paid = await prepareAndSign(mcp, log, tool, args, { kind: "pay", business: SENTINEL, units: price, msg: { action: "job", input: `check ${target}` } });
  if (!paid.ok) {
    log({ kind: "buy", from: SENTINEL, target, why, tool, ok: false, reason: paid.reason });
    return { verdict: null, job_id: null, tx: null } satisfies Vetting;
  }
  const jobId = jobIdFromLogs(paid.logs);
  let verdict: string | null = null;
  for (let i = 0; jobId !== null && i < 30 && !verdict; i++) {
    await new Promise((r) => setTimeout(r, 8_000));
    const check = await mcp.call("get_check", { business: SENTINEL, job_id: jobId });
    if (check.ok && check.data.status === "Done") verdict = check.data.verdict as string;
    if (check.ok && check.data.status === "Refunded") break;
  }
  log({ kind: "buy", from: SENTINEL, target, why, tool, price: fmt(price), job_id: jobId, verdict, ok: true, tx: paid.tx, explorer: explorer(paid.tx) });
  return { verdict, job_id: jobId, tx: paid.tx } satisfies Vetting;
}

/** An operator-only call on its own business, which no MCP tool prepares. */
async function operatorCall(method: string, args: Record<string, unknown>) {
  if (DRY) return { ok: false as const, reason: "dry run: not signed" };
  const sent = await sendCalls(keyAccount(ME), BUSINESS, [{ method, args, gas: 30n * TGAS, deposit: 0n }]);
  return sent.ok ? { ok: true as const, tx: sent.tx } : { ok: false as const, reason: `transaction ${sent.tx} failed: ${sent.failure}` };
}

const contractTerms = (t: NonNullable<Business["terms"]>): ContractTerms => ({
  principal: t.principal,
  total_due: t.total_due,
  lender_bps: t.lender_bps,
  operator_bps: t.operator_bps,
  funding_secs: t.funding_secs,
  term_secs: t.term_secs,
  window_secs: t.window_secs,
  min_payment_per_window: t.min_payment_per_window,
  grace_secs: t.grace_secs,
  auction_secs: t.auction_secs,
  auction_reserve_bps: t.auction_reserve_bps,
});

async function raising(mcp: Mcp, log: Log, b: Business) {
  const loanId = b.loan!.id;
  const answered = new Set(readLog(log.path).filter((e) => e.kind === "answer").map((e) => e.counter_tx));
  const counters = (await findCounters(ME, policy.token)).filter((c) => c.memo.business === BUSINESS && c.memo.loan_id === loanId && !answered.has(c.tx));
  if (!counters.length) {
    log({ kind: "wait", business: BUSINESS, loan_id: loanId, reason: "offer is open; no unanswered counter-offer on it yet" });
    return;
  }
  // The cheapest counter first: the smallest share of sales, then the smallest total due.
  counters.sort((a, b) => a.memo.lender_bps - b.memo.lender_bps || Number(BigInt(a.memo.total_due) - BigInt(b.memo.total_due)));
  for (const c of counters) {
    log({ kind: "counter_received", business: BUSINESS, loan_id: loanId, from: c.from, counter_tx: c.tx, explorer: explorer(c.tx), terms: c.memo, verified: "read from RPC: signed by the sender, ft_transfer on the pinned token, paid to this agent, memo parsed" });
    const vetting: Vetting = policy.vet_counterparty === "hire"
      ? await buyCheck(mcp, log, c.from, `vet the lender ${c.from} before re-offering on its counter`, "prepare_hire_check")
      : { verdict: null };
    const lenderHolds = BigInt(await view<string>(policy.token, "ft_balance_of", { account_id: c.from }));
    const answer = answerCounter(contractTerms(b.terms!), c.memo, policy, { vetting, lenderHolds });
    log({ kind: "answer", business: BUSINESS, loan_id: loanId, counter_tx: c.tx, from: c.from, decision: answer.decision, reasons: answer.reasons });
    if (answer.decision !== "accept") continue;

    const cancelled = await operatorCall("cancel_offer", {});
    log({ kind: "action", action: "cancel_offer", business: BUSINESS, loan_id: loanId, why: `re-offer on the terms countered in ${c.tx}`, ...cancelled, ...(cancelled.ok ? { explorer: explorer(cancelled.tx) } : {}) });
    if (!cancelled.ok) return;
    const offered = await operatorCall("create_offer", { terms: answer.terms });
    log({ kind: "action", action: "create_offer", business: BUSINESS, loan_id: loanId + 1, terms: answer.terms, why: `accepts the counter from ${c.from} (${c.tx})`, ...offered, ...(offered.ok ? { explorer: explorer(offered.tx) } : {}) });
    return;
  }
}

async function active(mcp: Mcp, log: Log, b: Business) {
  const loanId = b.loan!.id;
  const t = b.terms!;
  const history = readLog(log.path);
  const state = await view<{ ledger: { operator: string; opex: string }; service: { policy: { vendors: string[] } }; current_loan: { is_behind: boolean } | null; now: number }>(BUSINESS, "get_agent");

  // 1. Earnings: the operator's share of sales, withdrawable while the loan is current.
  const earned = BigInt(state.ledger.operator);
  if (earned > 0n && !state.current_loan?.is_behind) {
    const r = await operatorCall("withdraw_operator", {});
    log({ kind: "action", action: "withdraw_operator", business: BUSINESS, amount: fmt(earned), why: "its share of sales, to spend and repay from", ...r, ...(r.ok ? { explorer: explorer(r.tx) } : {}) });
  }

  // 2. Spend: buy a Sentinel check of the data vendor its business pays from working capital.
  const bought = history.filter((e) => e.kind === "spend" && e.tx && e.business === BUSINESS && e.loan_id === loanId).length;
  const vendor = state.service.policy.vendors[0];
  if (vendor && bought < policy.buy_checks_per_loan) {
    const v = await buyCheck(mcp, log, vendor, `its business pays ${vendor} for data on every sale, out of the loan's working capital; check the vendor before relying on it`, "prepare_buy_job");
    log({ kind: "spend", business: BUSINESS, loan_id: loanId, bought_from: SENTINEL, target: vendor, verdict: v.verdict, tx: v.tx });
  }

  // 3. Repay what the schedule needs by the end of this window.
  if (policy.repay_on_schedule && t.activated_at) {
    const activated = Math.floor(Date.parse(t.activated_at) / 1000);
    const needed = dueByWindowEnd(state.now, activated, t.window_secs, BigInt(t.min_payment_per_window), BigInt(t.total_due)) - BigInt(t.repaid);
    const wallet = BigInt(await view<string>(policy.token, "ft_balance_of", { account_id: ME }));
    if (needed <= 0n) {
      log({ kind: "repay", business: BUSINESS, loan_id: loanId, paid: "0", reason: `on schedule: ${fmt(BigInt(t.repaid))} repaid, the current window needs no more` });
      return;
    }
    const cap = units(policy.max_repay_per_run);
    const amount = [needed, cap, wallet].reduce((a, c) => (c < a ? c : a));
    if (amount <= 0n) {
      log({ kind: "repay", business: BUSINESS, loan_id: loanId, paid: "0", reason: `needs ${fmt(needed)} but holds ${fmt(wallet)}` });
      return;
    }
    const r = await prepareAndSign(mcp, log, "prepare_repay", { business: BUSINESS, payer: ME, amount: fmt(amount) }, { kind: "pay", business: BUSINESS, units: amount, msg: { action: "repay" } });
    log({ kind: "repay", business: BUSINESS, loan_id: loanId, paid: r.ok ? fmt(amount) : "0", needed: fmt(needed), wallet_before: fmt(wallet), why: "the schedule's minimum for this window, from its wallet (earnings plus its own funds)", ok: r.ok, ...(r.ok ? { tx: r.tx, explorer: explorer(r.tx) } : { reason: r.reason }) });
  }
}

async function pass(mcp: Mcp, log: Log) {
  const b = await mcp.must<Business>("get_business", { business: BUSINESS });
  if (b.operator !== ME) throw new Error(`${BUSINESS} is operated by ${b.operator}, not this agent (${ME}). Stopping.`);
  const state = b.loan?.state ?? "none";
  if (state === "Funding") return raising(mcp, log, b);
  if (state === "Active" || state === "Behind") return active(mcp, log, b);
  const offeredBefore = readLog(log.path).some((e) => e.kind === "action" && e.action === "create_offer" && e.ok);
  if (state === "none" && !offeredBefore) {
    const terms = toContractTerms(policy.opening_terms);
    const r = await operatorCall("create_offer", { terms });
    log({ kind: "action", action: "create_offer", business: BUSINESS, loan_id: 0, terms, why: `opening terms from policy: ${policy.opening_terms.principal} tUSD, repays ${policy.opening_terms.total_due}, lenders get ${policy.opening_terms.lender_bps / 100}% of sales`, ...r, ...(r.ok ? { explorer: explorer(r.tx) } : {}) });
    return;
  }
  log({ kind: "idle", business: BUSINESS, loan_state: state, reason: "nothing to do in this state" });
}

async function main() {
  const run = `${new Date().toISOString().slice(0, 19)}Z`;
  const log = logger(process.env.BORROWER_LOG ?? join(ROOT, "logs", "borrower.jsonl"), run);
  const mcp = new Mcp(MCP_URL);
  await mcp.initialize();
  log({ kind: "start", agent: ME, business: BUSINESS, mcp: MCP_URL, policy_sha256: policyHash, dry_run: DRY });
  const passes = arg("--passes", 1), every = arg("--every", 60);
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

await main();
