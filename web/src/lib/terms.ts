// The rules a loan offer must meet, caught before anything is signed.

import { duration, money } from "./format";
import type { LoanTerms } from "./near/types";

const DAY = 86_400;
const UNIT = 10n ** 6n;
/** The largest loan a business may ask for on a test network. */
const MAX_PRINCIPAL = 100_000n * UNIT;

export function bpsFrom(text: string): number | null {
  const n = Number(text);
  return Number.isFinite(n) && n >= 0 && n <= 100 ? Math.round(n * 100) : null;
}

/** Everything the contract's `validate::terms` refuses, caught before signing. */
export function validateTerms(t: LoanTerms): string | null {
  const principal = BigInt(t.principal);
  const due = BigInt(t.total_due);
  if (principal <= 0n) return "Enter how much to borrow.";
  if (principal > MAX_PRINCIPAL) return "Borrow at most $100,000 on the test network.";
  if (BigInt(t.min_payment_per_window) <= 0n) return "Set a minimum payment above zero, so lenders know what counts as on time.";
  if (due < principal) return "Interest cannot be negative.";
  if (t.lender_bps <= 0) return "Lenders must receive a share of revenue.";
  if (t.lender_bps + t.operator_bps > 10_000) return "Lenders' share and yours cannot add up to more than 100%.";
  if (t.auction_reserve_bps > 10_000) return "The reserve cannot exceed 100%.";
  for (const [value, name] of [[t.funding_secs, "Raising period"], [t.term_secs, "Length of the loan"], [t.window_secs, "Payment period"], [t.auction_secs, "Auction"]] as const) {
    if (value <= 0) return `${name} must be longer than zero.`;
    if (value > 10 * 365 * DAY) return `${name} can be at most ten years.`;
  }
  if (t.window_secs > t.term_secs) return "The payment period cannot be longer than the term.";
  if (BigInt(t.min_payment_per_window) > due) return "The minimum payment cannot exceed the total due.";
  return null;
}

/**
 * A warning, not a refusal: minimum payments are a floor, and sales are expected to cover the
 * rest. Said plainly so the owner knows what happens if they don't.
 */
export function minimumWarning(t: LoanTerms): string | null {
  const due = BigInt(t.total_due);
  const windows = BigInt(Math.floor(t.term_secs / t.window_secs));
  const total = BigInt(t.min_payment_per_window) * windows;
  if (windows <= 0n || total >= due) return null;
  return `The minimum payments alone (${money(total)} over ${duration(t.term_secs)}) won't clear the ${money(due)} debt; sales must cover the rest, or the business can be taken over at the end of the term.`;
}

