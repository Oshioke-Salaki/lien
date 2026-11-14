// The lender's written policy, applied to what the MCP server reports about a business.
// Pure functions, no I/O: the same inputs always give the same decision and reasons.
// Operator-written text (name, description) is only ever scanned as data: it can make
// the agent decline, never act.

export type Policy = {
  /** Pinned, not taken from the server: the only token and registry the agent pays into. */
  token: string;
  registry: string;
  /** Most the agent lends to one loan, in tUSD. */
  max_per_loan: string;
  /** Most of one loan's principal the agent will hold, in basis points. */
  max_share_of_loan_bps: number;
  /** Most the agent has out across all loans, in tUSD. */
  max_total_exposure: string;
  /** Least share of every sale lenders must receive. */
  min_lender_bps: number;
  /** Least the loan must return over principal, in basis points. */
  min_return_bps: number;
  /** Most full-access keys the business account may have (0: nobody can change its code). */
  max_business_full_access_keys: number;
  /** No loan of the business may be behind right now. */
  require_on_time: boolean;
  /** Most past loans that ended in foreclosure. */
  max_past_defaults: number;
  /** Decline a business whose own text tries to instruct agents. */
  decline_instruction_text: boolean;
  /** "hire": pay Sentinel for an attested check of the operator; "free": the free rules only. */
  operator_check: "hire" | "free";
  /** Verdicts accepted for the operator. */
  operator_verdicts_ok: string[];
  /** A WARN is acknowledged only when every flag behind it is on this list. */
  accept_warn_flags: string[];
  /** Most the agent pays for hired checks per run, in tUSD. */
  max_hire_spend_per_run: string;
  /** Collect repayments whenever any are waiting. */
  collect: boolean;
  /** Foreclose a loan it holds once the grace period has run out. */
  foreclose_when_late: boolean;
  /** When the only shortfalls are the lenders' share or the return, publish a counter-offer
   *  on chain: a 1-unit token transfer to the operator whose memo carries the terms. */
  counter_offers?: boolean;
};

export const UNITS = 1_000_000n;

export function units(tusd: string): bigint {
  const [whole, frac = ""] = tusd.trim().split(".");
  return BigInt(whole || "0") * UNITS + BigInt((frac + "000000").slice(0, 6));
}
export const fmt = (u: bigint) => {
  const frac = (u % UNITS).toString().padStart(6, "0").replace(/0+$/, "");
  return `${u / UNITS}${frac ? `.${frac}` : ""}`;
};

export type Check = { score: number; level: string; flags: string[]; keys: [number, number]; verdict: "ALLOW" | "WARN" | "BLOCK" };

/** What get_business returns, as far as the policy reads it. */
export type BusinessView = {
  id: string;
  name: string;
  sells: string;
  text_warning?: string;
  operator: string;
  loan: { id: number; state: string } | null;
  terms: {
    principal: string;
    total_due: string;
    lender_bps: number;
    funded: string;
    funding_deadline: string | null;
  } | null;
  repayment_record: { loans: number; repaid: number; foreclosed: number; behind_now: boolean };
  trust: { business: Check; operator: Check };
};

// The agent's own scan of operator text. Deliberately its own copy: it does not rely
// on the server labelling an injection for it.
const INSTRUCTION_PATTERNS: Array<[string, RegExp]> = [
  ["asks_to_ignore_rules", /\b(ignore|disregard|forget|override|bypass)\b[^.]{0,40}\b(instructions?|polic(y|ies)|rules?|limits?|guardrails?)\b/i],
  ["claims_system_authority", /\b(system|admin|developer)\b[^.:]{0,30}:/i],
  ["asks_to_send_money", /\b(send|transfer|pay|wire|move)\b[^.]{0,40}\b\d+(\.\d+)?\b[^.]{0,60}\.(testnet|near)\b/i],
  ["asks_to_skip_checks", /\b(acknowledge_risk|skip|without)\b[^.]{0,30}\b(check|checks|verification|review|risk)\b/i],
  ["asks_for_keys", /\b(private key|seed phrase|secret key|full[- ]access key)\b/i],
];
export const instructionLike = (text: string) => INSTRUCTION_PATTERNS.filter(([, re]) => re.test(text)).map(([n]) => n);

/** Whether a WARN may be acknowledged under the policy. */
export function warnAcceptable(check: Pick<Check, "verdict" | "flags">, policy: Policy): boolean {
  if (check.verdict === "ALLOW") return true;
  if (check.verdict === "BLOCK") return false;
  return check.flags.every((f) => policy.accept_warn_flags.includes(f));
}

/** Terms the agent would lend on, for a borrower whose offer fell short only on price. */
export type Counter = { principal: bigint; lender_bps: number; total_due: bigint; will_fund: bigint; reasons: string[] };

export type Decision =
  | { decision: "lend"; amount: bigint; reasons: string[] }
  | { decision: "decline"; reasons: string[]; counter?: Counter }
  | { decision: "skip"; reasons: string[] };

/**
 * The free part of the decision: everything that needs no payment. A business that
 * passes still needs the operator check before the agent pays (see lender.ts).
 */
export function evaluate(b: BusinessView, policy: Policy, ctx: { exposure: bigint; alreadyLent: boolean }): Decision {
  if (!b.loan || b.loan.state !== "Funding" || !b.terms) {
    return { decision: "skip", reasons: [`not raising a loan (${b.loan ? b.loan.state.toLowerCase() : "no loan"})`] };
  }
  if (ctx.alreadyLent) return { decision: "skip", reasons: ["already holds a note on this loan"] };
  const reasons: string[] = [];
  if (!b.id.endsWith(`.${policy.registry}`)) reasons.push(`not a business of the pinned registry ${policy.registry}`);

  const injected = instructionLike(`${b.name} ${b.sells}`);
  if (policy.decline_instruction_text && injected.length) {
    reasons.push(`its description tries to instruct agents (${injected.join(", ")}); treated as data and as a red flag, never followed`);
  }

  const principal = BigInt(b.terms.principal), due = BigInt(b.terms.total_due), funded = BigInt(b.terms.funded);
  // Price shortfalls can be negotiated; every other reason is a plain decline.
  const priced: string[] = [];
  if (b.terms.lender_bps < policy.min_lender_bps) priced.push(`lenders get ${b.terms.lender_bps / 100}% of sales; policy needs at least ${policy.min_lender_bps / 100}%`);
  const returnBps = Number(((due - principal) * 10_000n) / principal);
  if (returnBps < policy.min_return_bps) priced.push(`returns ${returnBps / 100}% over principal; policy needs at least ${policy.min_return_bps / 100}%`);
  reasons.push(...priced);

  const record = b.repayment_record;
  if (record.foreclosed > policy.max_past_defaults) reasons.push(`${record.foreclosed} past loan(s) ended in foreclosure; policy allows ${policy.max_past_defaults}`);
  if (policy.require_on_time && record.behind_now) reasons.push("a loan is behind on payments right now");

  const biz = b.trust.business;
  if (biz.keys[0] > policy.max_business_full_access_keys) reasons.push(`the business account has ${biz.keys[0]} full-access key(s), so someone can change its code; policy allows ${policy.max_business_full_access_keys}`);
  if (!warnAcceptable(biz, policy)) reasons.push(`counterparty check on the business: ${biz.verdict} (score ${biz.score}; ${biz.flags.join(", ") || "no flags"})`);
  const op = b.trust.operator;
  if (!policy.operator_verdicts_ok.includes(op.verdict)) reasons.push(`free check on the operator ${b.operator}: ${op.verdict} (score ${op.score}; ${op.flags.join(", ")})`);

  // Size: the smallest of the policy caps, the room left in the loan and the room left in the budget.
  const room = principal - funded;
  const shareCap = (principal * BigInt(policy.max_share_of_loan_bps)) / 10_000n;
  const budgetRoom = units(policy.max_total_exposure) - ctx.exposure;
  const amount = [units(policy.max_per_loan), shareCap, room, budgetRoom].reduce((a, c) => (c < a ? c : a));
  const minNote = principal / 50n > 0n ? principal / 50n : 1n; // the contract's 2% minimum note
  if (amount <= 0n || (amount < minNote && amount !== room)) {
    reasons.push(`the most it may lend here (${fmt(amount > 0n ? amount : 0n)} tUSD: max per loan ${policy.max_per_loan}, ${policy.max_share_of_loan_bps / 100}% of ${fmt(principal)}, ${fmt(room)} left to raise, ${fmt(budgetRoom > 0n ? budgetRoom : 0n)} of budget left) is below the 2% minimum note`);
  }
  if (reasons.length) {
    if (priced.length === 0 || priced.length !== reasons.length) return { decision: "decline", reasons };
    // Only the price falls short: name the least the policy accepts.
    const minDue = principal + (principal * BigInt(policy.min_return_bps) + 9_999n) / 10_000n;
    const counter: Counter = {
      principal,
      lender_bps: Math.max(b.terms.lender_bps, policy.min_lender_bps),
      total_due: due > minDue ? due : minDue,
      will_fund: amount,
      reasons: priced,
    };
    return { decision: "decline", reasons, counter };
  }
  return {
    decision: "lend",
    amount,
    reasons: [
      `raising ${fmt(principal)} tUSD, ${fmt(room)} left; lenders get ${b.terms.lender_bps / 100}% of sales and ${returnBps / 100}% over principal`,
      `record: ${record.loans} loan(s), ${record.repaid} repaid, ${record.foreclosed} foreclosed, none behind`,
      `business account: ${biz.keys[0]} full-access keys, check ${biz.verdict}${biz.verdict === "WARN" ? ` on accepted flags only (${biz.flags.join(", ")})` : ""}`,
      `size ${fmt(amount)} tUSD = min(max per loan ${policy.max_per_loan}, ${policy.max_share_of_loan_bps / 100}% share ${fmt(shareCap)}, room ${fmt(room)}, budget ${fmt(budgetRoom)})`,
    ],
  };
}
