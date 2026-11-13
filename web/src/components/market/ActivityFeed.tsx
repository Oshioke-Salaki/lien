"use client";

import Link from "next/link";
import { useLive } from "@/hooks/useLive";
import { fromNow, money } from "@/lib/format";
import { getJobs, getLoans } from "@/lib/near/rpc";
import type { Business } from "@/lib/near/types";

type Activity = { at: number; business: Business; text: string; key: string };

/**
 * What just happened on the network, across the featured businesses: checks sold, loans
 * raised and repaid, takeovers and sales. Built from the contracts' own records, newest first.
 */
async function readActivity(businesses: Business[]): Promise<Activity[]> {
  const per = await Promise.allSettled(
    businesses.map(async (b) => {
      const [jobs, loans] = await Promise.all([getJobs(b.id, 4), getLoans(b.id, 3)]);
      const items: Activity[] = [];
      for (const job of jobs) {
        if (job.status === "Done") items.push({ at: Number(job.created_at), business: b, key: `${b.id}:job:${job.id}`, text: `sold a safety check for ${money(job.paid)}, and its lenders were paid their share` });
        else if (job.status === "Refunded") items.push({ at: Number(job.created_at), business: b, key: `${b.id}:job:${job.id}`, text: `refunded a check that couldn't finish (${money(job.paid)} back to the buyer)` });
      }
      for (const loan of loans) {
        const size = money(loan.terms.principal);
        items.push({ at: loan.created_at, business: b, key: `${b.id}:loan:${loan.id}:offer`, text: `asked lenders for a ${size} loan` });
        if (loan.activated_at) items.push({ at: loan.activated_at, business: b, key: `${b.id}:loan:${loan.id}:active`, text: `raised its ${size} loan in full` });
        if (loan.foreclosed_at) items.push({ at: loan.foreclosed_at, business: b, key: `${b.id}:loan:${loan.id}:taken`, text: "was taken over for its lenders after missing payments" });
        if (loan.closed_at && loan.status === "Repaid") items.push({ at: loan.closed_at, business: b, key: `${b.id}:loan:${loan.id}:repaid`, text: `paid back its ${size} loan in full` });
        if (loan.closed_at && loan.status === "Sold") items.push({ at: loan.closed_at, business: b, key: `${b.id}:loan:${loan.id}:sold`, text: "was sold at auction; the price paid its lenders first" });
      }
      return items;
    }),
  );
  return per
    .flatMap((r) => (r.status === "fulfilled" ? r.value : []))
    .sort((a, b) => b.at - a.at)
    .slice(0, 8);
}

export function ActivityFeed({ businesses, now }: { businesses: Business[]; now: number }) {
  const ids = businesses.map((b) => b.id).join(",");
  const live = useLive(businesses.length ? () => readActivity(businesses) : null, `activity:${ids}`, 20_000);
  const items = live.data ?? [];
  return (
    <section aria-labelledby="activity-title" className="space-y-3" data-testid="activity">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="activity-title" className="flex items-center gap-2 text-[22px] font-medium tracking-[-0.015em]">
          <span aria-hidden className="live-dot" />Happening now
        </h2>
        <span className="text-[14px] muted">Read live from the network</span>
      </div>
      {!live.loaded ? (
        <div className="space-y-2" aria-busy="true">{[0, 1, 2].map((i) => <div key={i} className="skeleton h-[48px] w-full" />)}</div>
      ) : items.length === 0 ? (
        <p className="rounded-[12px] bg-[var(--surface)] p-4 text-[15px] text-[var(--ink-2)]">Nothing has happened yet. Buy a check or lend to a business, and it shows up here.</p>
      ) : (
        <ol className="divide-y divide-[var(--line)] overflow-hidden rounded-[16px] bg-[var(--surface)]">
          {items.map((item) => (
            <li key={item.key} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-3 text-[15px] sm:px-5">
              <span className="min-w-0">
                <Link className="font-medium hover:underline" href={`/b/${item.business.id}`}>{item.business.name}</Link>{" "}
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
