"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo } from "react";
import { Bar, EmptyState, ErrorState, PageHead, Skeleton, StandingLabel, STANDING_TONE } from "@/components/ui";
import { useLive } from "@/hooks/useLive";
import { percent, share, shortAccount, smartAmount, symbol } from "@/lib/format";
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

const COLS = "lg:grid-cols-[minmax(0,2.2fr)_minmax(0,1.3fr)_minmax(0,1.6fr)_minmax(0,1fr)_auto]";

export function MarketScreen() {
  const live = useLive(listBusinesses, "market", 8_000);
  const router = useRouter();
  const rows = useMemo(
    () => [...(live.data ?? [])].sort((a, b) => ORDER[standing(a)] - ORDER[standing(b)]),
    [live.data],
  );
  const count = (s: Standing[]) => rows.filter((b) => s.includes(standing(b))).length;
  const raisingCount = count(["funding"]);
  const paying = count(["current"]);
  const alerts = rows.filter((b) => isAlert(standing(b))).length;
  const lent = rows.reduce((sum, b) => sum + (b.current_loan && b.current_loan.status !== "Funding" ? BigInt(b.current_loan.funded) : 0n), 0n);
  const repaid = rows.reduce((sum, b) => sum + (b.current_loan ? BigInt(b.current_loan.repaid) : 0n), 0n);
  const sold = rows.reduce((sum, b) => sum + b.stats.jobs_done, 0);

  return (
    <div className="space-y-8">
      <PageHead
        title="Market"
        lead={
          <p data-testid="market-finding">
            {live.loaded
              ? rows.length === 0
                ? "No businesses yet. Be the first to start one."
                : `${raisingCount} raising, ${paying} paying on time, ${alerts} ${alerts === 1 ? "needs" : "need"} attention.`
              : "Reading the chain…"}
          </p>
        }
        action={<Link href="/create" className="btn btn-primary">Start a business</Link>}
      />

      {live.error && !live.data ? (
        <ErrorState message="The network could not be reached, so the market cannot be shown right now." onRetry={() => void live.refresh()} />
      ) : (
        <>
          <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {[
              { label: "Lent to businesses now", value: live.loaded ? `${smartAmount(lent)} ${symbol}` : null },
              { label: "Repaid on open loans", value: live.loaded ? `${smartAmount(repaid)} ${symbol}` : null },
              { label: "Work sold by these businesses", value: live.loaded ? sold.toLocaleString("en-US") : null },
            ].map((stat) => (
              <div key={stat.label} className="rounded-[16px] bg-[var(--surface)] p-5">
                <dt className="text-[14px] muted">{stat.label}</dt>
                <dd className="num mt-2 text-[28px] leading-none font-medium tracking-[-0.02em]">{stat.value ?? <span className="skeleton inline-block h-7 w-32 align-middle" />}</dd>
              </div>
            ))}
          </dl>

          <section aria-label="Every business on Lien, with what needs attention first" className="space-y-2">
            <div className={`hidden gap-6 px-5 pb-1 text-[13px] muted lg:grid ${COLS}`} aria-hidden>
              <span>Business</span><span>State</span><span>Loan</span><span>Lenders get</span><span className="w-[112px]" />
            </div>
            {!live.loaded ? (
              [0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[92px] w-full lg:h-[76px]" />)
            ) : rows.length === 0 ? (
              <EmptyState title="Nothing is listed yet" body="A business is a keyless account that sells work and can borrow against it. Start one and it appears here." action={{ href: "/create", label: "Start a business" }} />
            ) : (
              <ul className="space-y-2">
                {rows.map((b) => <MarketRow key={b.id} business={b} onOpen={() => router.push(`/b/${b.id}`)} />)}
              </ul>
            )}
          </section>

          {live.loaded ? <TryIt rows={rows} /> : null}
          <p className="max-w-[72ch] text-[14px] muted">
            Every figure is read live from the contracts. Each business is its own keyless account, so nothing here depends on Lien being honest.
          </p>
        </>
      )}
    </div>
  );
}

/** What a newcomer can do right now, built from the market's real state. */
function TryIt({ rows }: { rows: Business[] }) {
  const pick = (...states: Standing[]) => rows.find((b) => states.includes(standing(b)));
  const raising = pick("funding");
  const late = pick("foreclosable", "behind");
  const sale = pick("foreclosed", "auction");
  const serving = pick("current") ?? rows[0];
  const steps = [
    raising && { href: `/b/${raising.id}`, action: `Lend to ${raising.name}`, result: "You receive a note and a share of every sale." },
    serving && { href: `/b/${serving.id}`, action: `Buy a check from ${serving.name}`, result: "Sealed code runs in about 15 seconds, and the report lands on chain." },
    late && { href: `/b/${late.id}`, action: `Foreclose ${late.name}`, result: "Past grace, anyone can take it. It keeps serving customers." },
    sale && { href: `/b/${sale.id}`, action: `Bid on ${sale.name}`, result: "The highest bid takes a running business." },
  ].filter((s): s is { href: string; action: string; result: string } => Boolean(s));
  if (!steps.length) return null;
  return (
    <section aria-labelledby="try-title" className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="try-title" className="text-[22px] font-medium tracking-[-0.015em]">Things to try</h2>
        <span className="text-[14px] muted">Free on testnet, nothing to install</span>
      </div>
      <ul className="grid gap-3 sm:grid-cols-2">
        {steps.map((step) => (
          <li key={step.action}>
            <Link className="group flex h-full items-start justify-between gap-4 rounded-[16px] bg-[var(--surface)] p-5 transition-[background-color,transform] duration-200 hover:-translate-y-[2px] hover:bg-[var(--surface-2)]" href={step.href}>
              <span>
                <span className="block text-[17px] font-medium">{step.action}</span>
                <span className="mt-1 block text-[15px] text-[var(--ink-2)]">{step.result}</span>
              </span>
              <span aria-hidden className="mt-1 text-[var(--accent)] transition-transform duration-200 group-hover:translate-x-1">→</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

function MarketRow({ business: b, onOpen }: { business: Business; onOpen: () => void }) {
  const s = standing(b);
  const loan = b.current_loan;
  const raising = loan?.status === "Funding";
  const progress = loan ? (raising ? share(loan.funded, loan.terms.principal) : share(loan.repaid, loan.terms.total_due)) : 0;
  return (
    <li
      data-testid={`row-${b.id}`}
      onClick={onOpen}
      className={`grid cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-3 rounded-[16px] bg-[var(--surface)] p-5 transition-colors duration-150 hover:bg-[var(--surface-2)] lg:gap-6 lg:py-4 ${COLS}`}
    >
      <div className="min-w-0">
        <Link className="text-[17px] font-medium hover:underline" href={`/b/${b.id}`} onClick={(e) => e.stopPropagation()}>{b.name}</Link>
        <div className="truncate text-[13px] muted" title={b.id}>{shortAccount(b.id, 36)}</div>
      </div>
      <div className="justify-self-end lg:justify-self-start"><StandingLabel standing={s} /></div>
      <div className="col-span-2 min-w-0 lg:col-span-1">
        {loan ? (
          <>
            <div className="mb-2 flex justify-between gap-3 text-[14px]">
              <span className="num">{raising ? `${smartAmount(loan.funded)} of ${smartAmount(loan.terms.principal)} raised` : `${smartAmount(loan.repaid)} of ${smartAmount(loan.terms.total_due)} repaid`}</span>
              <span className="num muted">{progress}%</span>
            </div>
            <Bar value={progress} tone={raising ? "var(--accent)" : STANDING_TONE[s]} label={raising ? `${progress}% raised` : `${progress}% repaid`} />
          </>
        ) : <span className="text-[14px] muted">No loan. {b.stats.jobs_done} checks sold.</span>}
      </div>
      <div className="text-[14px] lg:text-[15px]">
        <span className="muted lg:hidden">Lenders get </span>
        {loan ? <span className="num">{percent(loan.terms.lender_bps)} of sales</span> : <span className="muted">-</span>}
      </div>
      <div className="justify-self-end">
        <Link className={`btn btn-sm min-w-[112px] ${s === "funding" || isAlert(s) ? "btn-primary" : "btn-secondary"}`} href={`/b/${b.id}`} onClick={(e) => e.stopPropagation()}>{nextStep(s)}</Link>
      </div>
    </li>
  );
}
