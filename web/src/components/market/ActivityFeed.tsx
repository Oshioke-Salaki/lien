"use client";

import Link from "next/link";
import { fromNow } from "@/lib/format";
import type { Activity } from "@/lib/snapshot";

/**
 * What just happened on the network, across the featured businesses: checks sold, loans
 * raised and repaid, takeovers and sales. Built on the server from the contracts' own
 * records (lib/snapshot.ts), newest first, and refreshed with the market.
 */
export function ActivityFeed({ items, now }: { items: Activity[]; now: number }) {
  return (
    <section aria-labelledby="activity-title" className="space-y-3" data-testid="activity">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="activity-title" className="flex items-center gap-2 text-[22px] font-medium tracking-[-0.015em]">
          <span aria-hidden className="live-dot" />Happening now
        </h2>
        <span className="text-[14px] muted">Read live from the network</span>
      </div>
      {items.length === 0 ? (
        <p className="rounded-[12px] bg-[var(--surface)] p-4 text-[15px] text-[var(--ink-2)]">Nothing has happened yet. Buy a check or lend to a business, and it shows up here.</p>
      ) : (
        <ol className="divide-y divide-[var(--line)] overflow-hidden rounded-[16px] bg-[var(--surface)]">
          {items.map((item) => (
            <li key={item.key} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-3 text-[15px] sm:px-5">
              <span className="min-w-0">
                <Link className="font-medium hover:underline" href={`/b/${item.businessId}`}>{item.businessName}</Link>{" "}
                <span className="text-[var(--ink-2)]">{item.text}</span>
              </span>
              <span className="shrink-0 text-[13px] muted">{fromNow(item.at, now)}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
