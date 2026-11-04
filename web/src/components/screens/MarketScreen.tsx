"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo } from "react";
import { Bar, ErrorState, Skeleton, StandingLabel } from "@/components/ui";
import { useLive } from "@/hooks/useLive";
import { amount, money, percent, share, shortAccount, symbol } from "@/lib/format";
import { listBusinesses } from "@/lib/near/rpc";
import type { Business } from "@/lib/near/types";
import { isAlert, standing, type Standing } from "@/lib/status";

/** What needs a decision comes first, then what can be funded. */
const ORDER: Record<Standing, number> = { foreclosable: 0, auction: 1, foreclosed: 2, behind: 3, funding: 4, current: 5, "no-loan": 6 };

function nextStep(s: Standing) {
  switch (s) {
    case "funding": return "Lend";
    case "foreclosable": return "Foreclose";
    case "foreclosed":
    case "auction": return "Bid";
    case "no-loan": return "Buy a check";
    default: return "View";
  }
}

export function MarketScreen() {
  const live = useLive(listBusinesses, "market", 8_000);
  const router = useRouter();
  const rows = useMemo(
    () => [...(live.data ?? [])].sort((a, b) => ORDER[standing(a)] - ORDER[standing(b)]),
    [live.data],
  );
  const open = rows.filter((b) => standing(b) === "funding").length;
  const alerts = rows.filter((b) => isAlert(standing(b))).length;
  const raising = rows
    .filter((b) => standing(b) === "funding")
    .reduce((sum, b) => sum + BigInt(b.current_loan!.terms.principal) - BigInt(b.current_loan!.funded), 0n);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[28px] leading-tight font-medium tracking-[-0.01em]">Market</h1>
          <p className="mt-1 text-[17px]" data-testid="market-finding">
            {live.loaded
              ? rows.length === 0
                ? "No businesses yet. Be the first to start one."
                : `${open} ${open === 1 ? "loan" : "loans"} raising ${money(raising)}, ${alerts} ${alerts === 1 ? "business needs" : "businesses need"} attention.`
              : "Reading the chain…"}
          </p>
        </div>
        <Link href="/create" className="btn btn-primary">Start a business</Link>
      </div>

      {live.error && !live.data ? (
        <ErrorState message="The network could not be reached, so the market cannot be shown right now." onRetry={() => void live.refresh()} />
      ) : (
        <div className="panel overflow-x-auto">
          <table className="table min-w-[860px]">
            <caption className="sr-only">Every business on Lien, with what needs attention first</caption>
            <thead>
              <tr>
                <th scope="col">Business</th>
                <th scope="col">Standing</th>
                <th scope="col" className="r">Loan, {symbol}</th>
                <th scope="col" className="r">Paid back</th>
                <th scope="col" className="r">Lenders get</th>
                <th scope="col" className="r">Jobs done</th>
                <th scope="col" className="r">Customers</th>
                <th scope="col"><span className="sr-only">Next step</span></th>
              </tr>
            </thead>
            <tbody>
              {!live.loaded
                ? [0, 1, 2].map((i) => (
                    <tr key={i}>
                      <td colSpan={8}><Skeleton className="h-9 w-full" /></td>
                    </tr>
                  ))
                : rows.map((b) => <MarketRow key={b.id} business={b} onOpen={() => router.push(`/b/${b.id}`)} />)}
              {live.loaded && rows.length === 0 ? (
                <tr><td colSpan={8} className="py-10 text-center muted">Nothing here yet.</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-[14px] muted">
        Every figure is read live from the contracts. Each business is its own keyless account, so nothing here depends on Lien being honest.
      </p>
    </div>
  );
}

function MarketRow({ business: b, onOpen }: { business: Business; onOpen: () => void }) {
  const s = standing(b);
  const loan = b.current_loan;
  const funded = loan ? share(loan.funded, loan.terms.principal) : 0;
  const repaid = loan ? share(loan.repaid, loan.terms.total_due) : 0;
  return (
    <tr data-row="link" data-testid={`row-${b.id}`} onClick={onOpen}>
      <td>
        <Link className="font-medium hover:underline" href={`/b/${b.id}`} onClick={(e) => e.stopPropagation()}>{b.name}</Link>
        <div className="max-w-[300px] truncate text-[13px] muted" title={b.id}>{shortAccount(b.id, 36)}</div>
      </td>
      <td><StandingLabel standing={s} /></td>
      <td className="r">
        {loan ? amount(loan.terms.principal) : <span className="muted">-</span>}
        {s === "funding" ? <div className="mt-2 ml-auto w-24"><Bar value={funded} label={`${funded}% funded`} /></div> : null}
      </td>
      <td className="r">
        {loan && loan.status !== "Funding" ? (
          <>
            {amount(loan.repaid)}
            <div className="text-[13px] muted">of {amount(loan.terms.total_due)}</div>
          </>
        ) : <span className="muted">-</span>}
        {loan && loan.status !== "Funding" ? <span className="sr-only">{repaid}%</span> : null}
      </td>
      <td className="r">{loan ? `${percent(loan.terms.lender_bps)} of sales` : <span className="muted">-</span>}</td>
      <td className="r">{b.stats.jobs_done.toLocaleString("en-US")}</td>
      <td className="r">{b.stats.unique_payers.toLocaleString("en-US")}</td>
      <td className="text-right">
        <Link className="btn btn-secondary btn-sm" href={`/b/${b.id}`} onClick={(e) => e.stopPropagation()}>{nextStep(s)}</Link>
      </td>
    </tr>
  );
}
