import type { Report } from "./near/types";

export const FLAG_TEXT: Record<string, string> = {
  account_does_not_exist: "This account does not exist.",
  owner_can_replace_contract_code: "Its owner holds a key and can replace the contract at any time.",
  contract_is_locked_no_one_can_change_it: "No one holds a key, so its contract cannot be changed.",
  account_is_locked_with_no_code: "No keys and no code: anything sent here is stuck.",
  many_full_access_keys: "Many people or machines can control this account.",
  almost_no_balance: "It holds almost no NEAR.",
  very_small_contract: "Its contract is unusually small.",
};

export function parseReport(raw: string | null): Report | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Report;
    return typeof value?.score === "number" && typeof value?.target === "string" ? value : null;
  } catch {
    return null;
  }
}
