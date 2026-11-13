// How the app reads an amount a person typed, with a reason for every refusal. Every money
// field (lend, bid, pay down, borrow, prices) uses these, so the same text means the same
// thing everywhere.

import { CENT, money, moneyUp, parseAmount } from "./format";

export type AmountCheck = { value: bigint | null; error: string | null };

/** Why some text is not a dollar amount at all, or null when it reads as one (empty is fine). */
export function amountProblem(text: string): string | null {
  const t = text.trim();
  if (t === "") return null;
  // "1,5" is a decimal comma, not a thousands separator: say so instead of misreading it as 15.
  if (/^\d+,\d{1,2}$/.test(t)) return "Use a dot for decimals, like 1.50.";
  if (/^-/.test(t)) return "Enter a positive amount, like 12.50.";
  if (/\.\d{3,}$/.test(t.replace(/,/g, ""))) return "Use at most two decimal places, like 12.50.";
  if (t.includes(",") && !/^\d{1,3}(,\d{3})+(\.\d*)?$/.test(t)) return "Write thousands as 1,000 or 1000, with a dot for decimals.";
  return parseAmount(t) === null ? "Enter an amount in dollars, like 12.50." : null;
}

export function checkAmount(text: string, { min, max, balance }: { min?: bigint; max?: bigint; balance?: bigint }): AmountCheck {
  if (text.trim() === "") return { value: null, error: null };
  const problem = amountProblem(text);
  if (problem) return { value: null, error: problem };
  const value = parseAmount(text)!;
  if (value === 0n) return { value: null, error: "Enter more than zero." };
  if (value < CENT) return { value, error: "The smallest amount is $0.01." };
  if (min !== undefined && value < min) return { value, error: `The minimum is ${moneyUp(min)}.` };
  if (max !== undefined && value > max) return { value, error: `The maximum is ${money(max)}.` };
  if (balance !== undefined && value > balance) return { value, error: `You hold ${money(balance)}.` };
  return { value, error: null };
}

/** An amount with at most two decimals, for fields where whole cents are all that make sense. */
export function parseMoney(text: string): bigint | null {
  return amountProblem(text) ? null : parseAmount(text);
}
