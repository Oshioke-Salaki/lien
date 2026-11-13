"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useSyncExternalStore } from "react";
import { ActivityFeed } from "@/components/market/ActivityFeed";
import { Bar, EmptyState, ErrorState, Info, PageHead, Skeleton, StandingLabel, STANDING_TONE } from "@/components/ui";
import { useLive } from "@/hooks/useLive";
import { money, moneyUp, pct, percent, share, shortAccount } from "@/lib/format";
import { listBusinesses } from "@/lib/near/rpc";
import type { Business } from "@/lib/near/types";
import { isSample } from "@/lib/demo";
import { auctionEnded, isAlert, standing, type Standing } from "@/lib/status";

/** What needs a decision comes first, then what can be funded. */
const ORDER: Record<Standing, number> = { foreclosable: 0, auction: 1, foreclosed: 2, behind: 3, funding: 4, current: 5, "no-loan": 6 };

function nextStep(s: Standing) {
  switch (s) {
    case "funding": return "Lend";
    case "foreclosable": return "Take over";
    case "foreclosed":
    case "auction": return "Bid";
    case "no-loan": return "Buy a check";
    default: return "View";
  }
}

const COLS = "lg:grid-cols-[minmax(0,2.2fr)_minmax(0,1.3fr)_minmax(0,1.6fr)_minmax(0,1fr)_auto]";

export function MarketScreen({ initial }: { initial?: Business[] }) {
  const live = useLive(listBusinesses, "market", 8_000, initial);
  const router = useRouter();
  const all = useMemo(
    () => [...(live.data ?? [])].sort((a, b) => ORDER[standing(a)] - ORDER[standing(b)]),
    [live.data],
  );
  // Featured: the team's samples and any business with real activity. Businesses a visitor
  // started and never used are listed separately, folded, so they never crowd the market.
  const featured = (b: Business) => isSample(b.id) || b.stats.unique_payers >= 2;
  const rows = all.filter(featured);
  const started = all.filter((b) => !featured(b));
  const now = all.reduce((latest, b) => Math.max(latest, b.now), 0);
  const count = (s: Standing[]) => rows.filter((b) => s.includes(standing(b))).length;
  const raisingCount = count(["funding"]);
  const paying = count(["current"]);
  const alerts = rows.filter((b) => isAlert(standing(b))).length;
  const noLoan = count(["no-loan"]);
  const finding = [
    `${raisingCount} raising`,
    `${paying} paying on time`,
    `${alerts} ${alerts === 1 ? "needs" : "need"} attention`,
    ...(noLoan ? [`${noLoan} with no loan`] : []),
  ].join(", ");
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
                : `${rows.length} featured ${rows.length === 1 ? "business" : "businesses"}: ${finding}.${started.length ? ` Plus ${started.length} started by visitors.` : ""}`
              : "Reading the chain…"}
          </p>
        }
        action={<div className="flex items-center gap-4"><ReopenIntro /><Link href="/create" className="btn btn-primary">Start a business</Link></div>}
      />

      <HowItWorks />

      {live.error && !live.data ? (
        <ErrorState message="The network could not be reached, so the market cannot be shown right now." onRetry={() => void live.refresh()} />
      ) : (
        <>
          <dl className="grid grid-cols-3 gap-2 sm:gap-3">
            {[
              { label: "Lent out now", tip: "Money lenders have in loans that have started, across the featured businesses.", value: live.loaded ? money(lent) : null },
              { label: "Repaid to lenders", tip: "Money that has already reached lenders on these loans, from sales and payments.", value: live.loaded ? money(repaid) : null },
              { label: "Checks sold", tip: "Safety checks these businesses have sold and delivered. Each sale repays their lenders first.", value: live.loaded ? sold.toLocaleString("en-US") : null },
            ].map((stat) => (
              <div key={stat.label} className="rounded-[16px] bg-[var(--surface)] p-3 sm:p-5">
                <dt className="text-[13px] leading-snug muted sm:text-[14px]">{stat.label}<Info label={stat.label} tip={stat.tip} /></dt>
                <dd className="num mt-2 text-[18px] sm:text-[28px] leading-none font-medium tracking-[-0.02em]">{stat.value ?? <span className="skeleton inline-block h-6 w-full max-w-32 align-middle" />}</dd>
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
              <EmptyState title="Nothing is listed yet" body="A business here is an AI agent that sells a service and can borrow against its sales. Start one and it appears here." action={{ href: "/create", label: "Start a business" }} />
            ) : (
              <ul className="space-y-2">
                {rows.map((b) => <MarketRow key={b.id} business={b} onOpen={() => router.push(`/b/${b.id}`)} />)}
              </ul>
            )}
            {started.length ? (
              <details className="group rounded-[16px] bg-[var(--surface)]" data-testid="started-by-visitors">
                <summary className="flex min-h-[56px] cursor-pointer list-none items-center justify-between gap-3 px-5 text-[16px] font-medium [&::-webkit-details-marker]:hidden">
                  Started by visitors ({started.length})
                  <span aria-hidden className="text-[var(--muted)] transition-transform group-open:rotate-180">▾</span>
                </summary>
                <p className="px-5 pb-3 text-[14px] text-[var(--ink-2)]">Businesses people started while trying Lien, with no loan or sales yet.</p>
                <ul className="space-y-2 px-2 pb-2">
                  {started.map((b) => <MarketRow key={b.id} business={b} onOpen={() => router.push(`/b/${b.id}`)} />)}
                </ul>
              </details>
            ) : null}
          </section>

          {live.loaded && rows.length ? <ActivityFeed businesses={rows} now={now} /> : null}

          {live.loaded ? <TryIt rows={rows} /> : null}
          <p className="max-w-[72ch] text-[14px] muted">
            Every figure is read live from the network. No person holds the keys to any business here, so none of this depends on trusting Lien.
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
    raising && { href: `/b/${raising.id}`, action: `Lend to ${raising.name}`, result: "You get a share of the loan, repaid from every sale it makes." },
    serving && { href: `/b/${serving.id}`, action: `Buy a safety check from ${serving.name}`, result: "A report on any account, usually in under a minute. If it fails, you get your money back." },
    late && { href: `/b/${late.id}`, action: `Take over ${late.name}`, result: "It missed its payments, so anyone can take it over for its lenders. It keeps serving customers." },
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
        <div className="truncate text-[13px] muted" title={b.id}>{isSample(b.id) ? "Sample by the Lien team" : shortAccount(b.id, 36)}</div>
      </div>
      <div className="justify-self-end lg:justify-self-start"><StandingLabel standing={s} /></div>
      <div className="col-span-2 min-w-0 lg:col-span-1">
        {loan ? (
          <>
            <div className="mb-2 flex justify-between gap-3 text-[14px]">
              <span className="num">{raising ? `${money(loan.funded)} of ${money(loan.terms.principal)} raised` : `${money(loan.repaid)} of ${money(loan.terms.total_due)} paid back`}</span>
              <span className="num muted">{pct(progress)}</span>
            </div>
            <Bar value={progress} tone={raising ? "var(--accent)" : STANDING_TONE[s]} label={raising ? `${pct(progress)} raised` : `${pct(progress)} repaid`} />
          </>
        ) : <span className="text-[14px] muted">No loan. {b.stats.jobs_done} {b.stats.jobs_done === 1 ? "check" : "checks"} sold.</span>}
        {loan?.status === "Foreclosed" && !auctionEnded(loan, b.now) && loan.min_next_bid && BigInt(loan.min_next_bid) < BigInt(b.ledger.opex) ? (
          <p className="mt-2 text-[13px] text-[var(--ink-2)]" data-testid="bargain-row">Lowest bid {moneyUp(loan.min_next_bid)}, below the {money(b.ledger.opex)} of running money inside. Its terms allow it.</p>
        ) : null}
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

const INTRO_KEY = "lien:intro-dismissed";
const INTRO_EVENT = "lien:intro";
const readIntro = () => {
  try { return localStorage.getItem(INTRO_KEY) === "1"; } catch { return false; }
};
const watchIntro = (changed: () => void) => {
  window.addEventListener("storage", changed);
  window.addEventListener(INTRO_EVENT, changed);
  return () => {
    window.removeEventListener("storage", changed);
    window.removeEventListener(INTRO_EVENT, changed);
  };
};
const dismissIntro = () => {
  try { localStorage.setItem(INTRO_KEY, "1"); } catch { /* a private window keeps showing it */ }
  window.dispatchEvent(new Event(INTRO_EVENT));
};

const reopenIntro = () => {
  try { localStorage.removeItem(INTRO_KEY); } catch { /* nothing to undo */ }
  window.dispatchEvent(new Event(INTRO_EVENT));
};

/** Once "How Lien works" is hidden, a small link brings it back. */
function ReopenIntro() {
  const hidden = useSyncExternalStore(watchIntro, readIntro, () => false);
  return hidden ? <button type="button" className="link text-[15px]" onClick={reopenIntro}>How it works</button> : null;
}

const STEPS = [
  { title: "An AI agent borrows", body: "It runs as a NEAR account that nobody holds the keys to, so no one can walk off with the loan." },
  { title: "Every sale repays lenders first", body: "A fixed share of each sale goes to the lenders before the owner sees anything." },
  { title: "Stop paying, lose the business", body: "Anyone can take over a late agent. It keeps working for its lenders until it is sold." },
];

/** Lien in three plain steps, for anyone who arrives here first. Hidden once dismissed. */
function HowItWorks() {
  const hidden = useSyncExternalStore(watchIntro, readIntro, () => false);
  // On a phone the three steps fold into one line, so the businesses start on the first screen.
  const [open, setOpen] = useState(false);
  if (hidden) return null;
  return (
    <section aria-labelledby="how-title" data-testid="how-it-works" className="rounded-[16px] bg-[var(--surface)] p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="how-title" className="text-[18px] font-medium tracking-[-0.01em] sm:text-[20px]">How Lien works</h2>
        <button type="button" className="link text-[15px] sm:hidden" aria-expanded={open} aria-controls="how-steps" onClick={() => setOpen(!open)}>{open ? "Hide the steps" : "Show the three steps"}</button>
        <div className="hidden items-center gap-4 text-[15px] sm:flex">
          <a href="/#try" className="link">See it in a simulator</a>
          <button type="button" className="link muted" onClick={dismissIntro}>Got it, hide this</button>
        </div>
      </div>
      <ol id="how-steps" className={`mt-4 gap-4 sm:mt-5 sm:grid sm:grid-cols-3 ${open ? "grid" : "hidden"}`}>
        {STEPS.map((step, i) => (
          <li key={step.title} className="flex gap-3">
            <span aria-hidden className="grid h-7 w-7 flex-none place-items-center rounded-full bg-[var(--accent)] text-[14px] font-medium text-[#0c0a08]">{i + 1}</span>
            <div>
              <p className="font-medium">{step.title}</p>
              <p className="mt-1 text-[15px] leading-snug text-[var(--ink-2)]">{step.body}</p>
            </div>
          </li>
        ))}
        <li className="flex items-center gap-4 text-[15px] sm:hidden">
          <a href="/#try" className="link">See it in a simulator</a>
          <button type="button" className="link muted" onClick={dismissIntro}>Got it, hide this</button>
        </li>
      </ol>
    </section>
  );
}
