// Checks a visitor bought from a business, remembered in this browser per business and
// account. Written the moment a check is paid for (not later), so a refresh, Back or a
// closed tab never loses one: the page reads the list back and follows each to its result.

export type SavedCheck = {
  /** The job number, as first expected; replaced by the real one once the transaction confirms. */
  id: number;
  input: string;
  /** When it was bought, in seconds. */
  since: number;
  /** True once the transaction named the job, so the number is certain. */
  confirmed: boolean;
  status?: "Pending" | "Done" | "Refunded";
  reason?: string;
  report?: string | null;
};

const key = (business: string, account: string) => `lien:checks:${business}:${account}`;
const MAX = 6;

export function loadChecks(business: string, account: string | null): SavedCheck[] {
  if (!account) return [];
  try {
    const list = JSON.parse(localStorage.getItem(key(business, account)) ?? "[]");
    return Array.isArray(list) ? (list as SavedCheck[]).filter((c) => typeof c?.id === "number" && typeof c?.input === "string").slice(0, MAX) : [];
  } catch {
    return [];
  }
}

export function saveChecks(business: string, account: string | null, list: SavedCheck[]): SavedCheck[] {
  const kept = list.slice(0, MAX);
  if (!account) return kept;
  try {
    localStorage.setItem(key(business, account), JSON.stringify(kept));
  } catch {
    /* storage unavailable: the check still runs, it is just not remembered */
  }
  return kept;
}

export const isFinal = (c: SavedCheck) => c.status === "Done" || c.status === "Refunded";
