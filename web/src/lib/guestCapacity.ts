/** Shown when the sponsor that pays for free test accounts has run out of test NEAR. */
export const GUEST_PAUSED =
  "Free test accounts are paused while we refill test funds. Connect a NEAR testnet wallet to keep going, or try again in a few hours.";

export type GuestCapacity = { available: boolean; accounts: number | null; businesses: number | null };

let cached: { at: number; value: GuestCapacity } | null = null;
let pending: Promise<GuestCapacity> | null = null;

/** What the sponsor can still cover, read from the server at most every 30 seconds. */
export async function readGuestCapacity(force = false): Promise<GuestCapacity> {
  if (!force && cached && Date.now() - cached.at < 30_000) return cached.value;
  if (pending) return pending;
  pending = fetch("/api/guest", { cache: "no-store", signal: AbortSignal.timeout(8_000) })
    .then((r) => r.json() as Promise<GuestCapacity>)
    .catch(() => ({ available: true, accounts: null, businesses: null }) as GuestCapacity)
    .then((value) => {
      cached = { at: Date.now(), value };
      pending = null;
      return value;
    });
  return pending;
}
