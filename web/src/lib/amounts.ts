// How the app reads an amount a person typed, with a reason for every refusal.

import { CENT, money, moneyUp, parseAmount } from "./format";

export type AmountCheck = { value: bigint | null; error: string | null };

export function checkAmount(text: string, { min, max, balance }: { min?: bigint; max?: bigint; balance?: bigint }): AmountCheck {
  if (text.trim() === "") return { value: null, error: null };
  // "1,5" is a decimal comma, not a thousands separator: say so instead of misreading it as 15.
  if (/^\d+,\d{1,2}$/.test(text.trim())) return { value: null, error: "Use a dot for decimals, like 1.50." };
  const clean = text.trim().replace(/,/g, "");
  if (/^-/.test(clean)) return { value: null, error: "Enter a positive amount, like 12.50." };
  if (/\.\d{3,}$/.test(clean)) return { value: null, error: "Use at most two decimal places, like 12.50." };
  const value = parseAmount(text);
  if (value === null) return { value: null, error: "Enter an amount in dollars, like 12.50." };
  if (value === 0n) return { value: null, error: "Enter more than zero." };
  if (value < CENT) return { value, error: "The smallest amount is $0.01." };
  if (min !== undefined && value < min) return { value, error: `The minimum is ${moneyUp(min)}.` };
  if (max !== undefined && value > max) return { value, error: `The maximum is ${money(max)}.` };
  if (balance !== undefined && value > balance) return { value, error: `You hold ${money(balance)}.` };
  return { value, error: null };
}
