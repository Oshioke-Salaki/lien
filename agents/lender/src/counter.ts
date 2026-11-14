// A counter-offer, published on chain where the borrower can read it without trusting
// the lender or any server: a transfer of 1 unit (0.000001 tUSD) of the pinned token to
// the business's operator, whose memo is this JSON. The token records the memo in the
// transaction's own arguments and in its NEP-141 event, the lender's key signs it, and
// anyone can fetch it from any RPC by hash. An indexer is only used to find the hash.
//
// A counter is a statement, not a promise the contract enforces: the lender may still
// decline a re-offer (its free and paid checks run again), and the borrower decides by
// its own policy whether the counter is worth taking.

import type { Counter } from "./policy";

export const COUNTER_TAG = "lien-counter/1";

export type CounterMemo = {
  t: typeof COUNTER_TAG;
  business: string;
  loan_id: number;
  /** The terms the lender would lend on, in token units and basis points. */
  principal: string;
  lender_bps: number;
  total_due: string;
  /** What the lender would put in, at most, if the business re-offers on these terms. */
  will_fund: string;
  reasons: string[];
  /** First 16 hex digits of the sha256 of the lender's policy.json at the time. */
  policy: string;
};

export function counterMemo(business: string, loanId: number, c: Counter, policySha: string): CounterMemo {
  return {
    t: COUNTER_TAG,
    business,
    loan_id: loanId,
    principal: c.principal.toString(),
    lender_bps: c.lender_bps,
    total_due: c.total_due.toString(),
    will_fund: c.will_fund.toString(),
    reasons: c.reasons,
    policy: policySha,
  };
}

const isUnits = (v: unknown) => typeof v === "string" && /^\d{1,30}$/.test(v);

/** Parses a memo read from chain. Anything malformed is not a counter. */
export function parseCounterMemo(memo: unknown): CounterMemo | null {
  if (typeof memo !== "string" || memo.length > 2_000) return null;
  let m: any;
  try {
    m = JSON.parse(memo);
  } catch {
    return null;
  }
  if (!m || m.t !== COUNTER_TAG) return null;
  if (typeof m.business !== "string" || !Number.isInteger(m.loan_id)) return null;
  if (!isUnits(m.principal) || !isUnits(m.total_due) || !isUnits(m.will_fund)) return null;
  if (!Number.isInteger(m.lender_bps) || m.lender_bps <= 0 || m.lender_bps > 10_000) return null;
  if (!Array.isArray(m.reasons) || !m.reasons.every((r: unknown) => typeof r === "string")) return null;
  if (typeof m.policy !== "string") return null;
  return m as CounterMemo;
}
