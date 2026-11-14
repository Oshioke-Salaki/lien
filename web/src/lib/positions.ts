// Folding each positions read into the last one, so a business that could not be read this
// time keeps the rows it had: a slow node never makes a loan vanish from the page.

import type { PositionsSnapshot } from "./snapshot";

const byBusiness = <T extends { businessId: string }>(list: T[]) => (a: T, b: T) =>
  a.businessId.localeCompare(b.businessId) || list.indexOf(a) - list.indexOf(b);

export function mergePositions(prev: PositionsSnapshot | undefined, next: PositionsSnapshot): PositionsSnapshot {
  if (!prev) return next;
  const fresh = new Set(next.readIds ?? []);
  const unread = new Set(next.unreadIds);
  // From the last read: rows of businesses this read did not reach.
  const kept = <T extends { businessId: string }>(old: T[], now: T[]) => {
    const all = [...now, ...old.filter((x) => !fresh.has(x.businessId))];
    return all.sort(byBusiness(all));
  };
  const listedNow = new Set(next.businesses.map((b) => b.id));
  const businesses = [...next.businesses, ...prev.businesses.filter((b) => !listedNow.has(b.id))];
  const readIds = [...new Set([...(prev.readIds ?? []), ...fresh])];
  const ever = new Set(readIds);
  const stillUnread = next.unreadIds.filter((id) => !ever.has(id));
  // Owned and bid on come from the listing itself: keep the old answer only where the listing failed.
  const listedOld = (ids: string[]) => ids.filter((id) => unread.has(id));
  return {
    ...next,
    businesses,
    names: { ...prev.names, ...next.names },
    positions: kept(prev.positions, next.positions),
    credits: kept(prev.credits, next.credits),
    bought: kept(prev.bought ?? [], next.bought ?? []),
    operated: [...new Set([...next.operated, ...listedOld(prev.operated)])],
    bids: [...new Set([...next.bids, ...listedOld(prev.bids)])],
    readIds,
    checked: Math.min(next.total, next.total - stillUnread.length),
    unread: stillUnread.length,
    unreadIds: stillUnread,
  };
}
