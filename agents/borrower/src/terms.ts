// The borrower's written policy, applied to a lender's counter-offer and to its own
// repayment schedule. Pure functions, no I/O: the same inputs always give the same
// decision and reasons.

import type { CounterMemo } from "../../lender/src/counter";
import { fmt, units } from "../../lender/src/policy";

export type OpeningTerms = {
  principal: string;
  total_due: string;
  lender_bps: number;
  operator_bps: number;
  funding_secs: number;
  term_secs: number;
  window_secs: number;
  min_payment_per_window: string;
  grace_secs: number;
  auction_secs: number;
  auction_reserve_bps: number;
};

export type BorrowerPolicy = {
  token: string;
  registry: string;
  business: { name: string; label_prefix: string; description: string };
  /** What it asks for first, in tUSD. */
  opening_terms: OpeningTerms;
  /** The most of every sale it will give lenders. */
  max_lender_bps: number;
  /** The most it will pay over principal, in basis points. */
  max_return_bps: number;
  /** The least of every sale it keeps for its operator. */
  min_operator_bps: number;
  /** "hire": pay Sentinel to vet the lender behind a counter before acting on it. */
  vet_counterparty: "hire" | "free";
  counterparty_verdicts_ok: string[];
  /** Act on a counter only if the lender holds at least what it says it will fund. */
  require_lender_holds_will_fund: boolean;
  /** Sentinel checks it buys while a loan is active, per loan. */
  buy_checks_per_loan: number;
  max_check_spend_per_run: string;
  /** Pay what the schedule needs before each window ends. */
  repay_on_schedule: boolean;
  max_repay_per_run: string;
};

/** Loan terms as the contract takes them: token units as decimal strings. */
export type ContractTerms = Omit<OpeningTerms, "principal" | "total_due" | "min_payment_per_window"> & {
  principal: string;
  total_due: string;
  min_payment_per_window: string;
};

export function toContractTerms(t: OpeningTerms): ContractTerms {
  return { ...t, principal: units(t.principal).toString(), total_due: units(t.total_due).toString(), min_payment_per_window: units(t.min_payment_per_window).toString() };
}

export type Answer =
  | { decision: "accept"; terms: ContractTerms; reasons: string[] }
  | { decision: "walk_away"; reasons: string[] };

export type Vetting = { verdict: string | null; job_id?: number | null; tx?: string | null };

/**
 * Whether to re-offer on a lender's counter. `current` is the offer on chain now.
 * `lenderHolds` is the lender's token balance, read from the token, not from the lender.
 */
export function answerCounter(current: ContractTerms, counter: CounterMemo, policy: BorrowerPolicy, ctx: { vetting: Vetting; lenderHolds: bigint }): Answer {
  const reasons: string[] = [];
  const principal = BigInt(current.principal);
  const due = BigInt(counter.total_due);
  if (BigInt(counter.principal) !== principal) reasons.push(`the counter is for ${fmt(BigInt(counter.principal))} tUSD; the business asked for ${fmt(principal)}`);
  if (counter.lender_bps > policy.max_lender_bps) reasons.push(`it asks for ${counter.lender_bps / 100}% of sales; policy gives lenders at most ${policy.max_lender_bps / 100}%`);
  const returnBps = principal > 0n ? Number(((due - principal) * 10_000n) / principal) : 0;
  if (due < principal) reasons.push("it asks to repay less than principal, which the contract refuses");
  if (returnBps > policy.max_return_bps) reasons.push(`it asks for ${returnBps / 100}% over principal; policy pays at most ${policy.max_return_bps / 100}%`);
  if (counter.lender_bps + current.operator_bps > 10_000) reasons.push(`lenders ${counter.lender_bps / 100}% and operator ${current.operator_bps / 100}% exceed 100%`);
  if (current.operator_bps < policy.min_operator_bps) reasons.push(`the operator would keep ${current.operator_bps / 100}%; policy needs ${policy.min_operator_bps / 100}%`);
  const willFund = BigInt(counter.will_fund);
  if (willFund === 0n) reasons.push("the lender commits nothing");
  if (policy.require_lender_holds_will_fund && ctx.lenderHolds < willFund) reasons.push(`the lender holds ${fmt(ctx.lenderHolds)} tUSD, less than the ${fmt(willFund)} it offers`);
  if (policy.vet_counterparty === "hire" && !(ctx.vetting.verdict && policy.counterparty_verdicts_ok.includes(ctx.vetting.verdict))) {
    reasons.push(`Sentinel's verdict on the lender is ${ctx.vetting.verdict ?? "missing"}; policy needs ${policy.counterparty_verdicts_ok.join(" or ")}`);
  }
  if (reasons.length) return { decision: "walk_away", reasons };
  return {
    decision: "accept",
    terms: { ...current, lender_bps: counter.lender_bps, total_due: due.toString() },
    reasons: [
      `lenders get ${counter.lender_bps / 100}% of sales (was ${current.lender_bps / 100}%, policy allows up to ${policy.max_lender_bps / 100}%)`,
      `repays ${fmt(due)} on ${fmt(principal)}: ${returnBps / 100}% over principal (was ${fmt(BigInt(current.total_due))}, policy allows up to ${policy.max_return_bps / 100}%)`,
      `the lender holds ${fmt(ctx.lenderHolds)} tUSD and offers ${fmt(willFund)}`,
      ...(policy.vet_counterparty === "hire" ? [`Sentinel vetted the lender: ${ctx.vetting.verdict} (job ${ctx.vetting.job_id}, tx ${ctx.vetting.tx})`] : []),
    ],
  };
}

/** What the schedule needs repaid by the end of the current window. */
export function dueByWindowEnd(now: number, activatedAt: number, windowSecs: number, minPerWindow: bigint, totalDue: bigint): bigint {
  const windows = BigInt(Math.floor(Math.max(0, now - activatedAt) / windowSecs) + 1);
  const needed = minPerWindow * windows;
  return needed < totalDue ? needed : totalDue;
}
