// One read of the chain shared by every request for a few seconds, on the server.
// Concurrent requests wait for the same read instead of starting their own.

import { readMarket, readPositions, type MarketSnapshot, type PositionsSnapshot } from "./snapshot";

type Entry<T> = { at: number; value?: T; pending?: Promise<T> };

function cached<T>(store: Map<string, Entry<T>>, key: string, ttlMs: number, read: () => Promise<T>): Promise<T> {
  const entry = store.get(key);
  if (entry?.value !== undefined && Date.now() - entry.at < ttlMs) return Promise.resolve(entry.value);
  if (entry?.pending) return entry.pending;
  const pending = read()
    .then((value) => {
      store.set(key, { at: Date.now(), value });
      return value;
    })
    .catch((error) => {
      // Keep serving the last good answer if there is one.
      const last = store.get(key);
      store.set(key, { at: last?.at ?? 0, value: last?.value });
      if (last?.value !== undefined) return last.value;
      throw error;
    });
  store.set(key, { at: entry?.at ?? 0, value: entry?.value, pending });
  // Callers who arrive while a stale answer exists get it at once; the fresh one lands for the next.
  return entry?.value !== undefined ? Promise.resolve(entry.value) : pending;
}

const markets = new Map<string, Entry<MarketSnapshot>>();
const positions = new Map<string, Entry<PositionsSnapshot>>();

export const cachedMarket = () => cached(markets, "market", 5_000, readMarket);
export const cachedPositions = (account: string) => cached(positions, account, 4_000, () => readPositions(account));
