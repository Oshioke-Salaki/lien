// The browser's side of the server snapshots: one request instead of dozens of RPC calls.

import type { MarketSnapshot, PositionsSnapshot } from "./snapshot";

async function getJson<T>(url: string, timeoutMs: number): Promise<T> {
  const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), cache: "no-store" });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? "The network could not be reached.");
  }
  return (await response.json()) as T;
}

export const fetchMarket = () => getJson<MarketSnapshot>("/api/market", 25_000);
export function fetchPositions(account: string, hints: { first?: string[]; also?: string[] } = {}) {
  const query = new URLSearchParams({ account });
  if (hints.first?.length) query.set("first", hints.first.slice(0, 50).join(","));
  if (hints.also?.length) query.set("also", hints.also.slice(0, 50).join(","));
  return getJson<PositionsSnapshot>(`/api/positions?${query}`, 30_000);
}
