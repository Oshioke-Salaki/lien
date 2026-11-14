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

/** Points each flag adds to the score, as Sentinel's rules give them (lib/risk.ts assess; not changed here). */
export const FLAG_POINTS: Record<string, number> = {
  account_does_not_exist: 90,
  owner_can_replace_contract_code: 40,
  contract_is_locked_no_one_can_change_it: 0,
  account_is_locked_with_no_code: 50,
  many_full_access_keys: 20,
  almost_no_balance: 15,
  very_small_contract: 10,
};

const keysWord = (n: number) => (n === 1 ? "1 full-access key" : `${n} full-access keys`);

/**
 * A flag in plain words, with the count behind it where the report has one: what was found,
 * then what it means for someone about to pay this account.
 */
export function explainFlag(flag: string, report: Pick<Report, "keys">): { found: string; means: string } {
  const full = report.keys?.[0] ?? 0;
  switch (flag) {
    case "many_full_access_keys":
      return { found: keysWord(full), means: "many people or machines can change this account or empty it." };
    case "owner_can_replace_contract_code":
      return { found: `${keysWord(full)} on a contract`, means: "whoever holds it can replace the code at any time, so what it does today may not be what it does tomorrow." };
    case "account_is_locked_with_no_code":
      return { found: "No keys and no code", means: "nothing can move money out, so anything sent here is stuck for good." };
    case "almost_no_balance":
      return { found: "Less than 1 NEAR", means: "it holds almost nothing, which is common for new or throwaway accounts." };
    case "very_small_contract":
      return { found: "A very small contract", means: "it uses under 50 KB of storage, which can mean a placeholder or a bare forwarder." };
    case "contract_is_locked_no_one_can_change_it":
      return { found: "No keys on a contract", means: "nobody can change its code, a good sign." };
    case "account_does_not_exist":
      return { found: "No such account", means: "anything sent to this name could be lost." };
    default:
      return { found: flag.replaceAll("_", " "), means: "" };
  }
}

export function parseReport(raw: string | null): Report | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Report;
    return typeof value?.score === "number" && typeof value?.target === "string" ? value : null;
  } catch {
    return null;
  }
}
