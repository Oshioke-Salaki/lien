"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useSyncExternalStore } from "react";
import { ActivityFeed } from "@/components/market/ActivityFeed";
import { Bar, EmptyState, ErrorState, Info, PageHead, Skeleton, StandingLabel, STANDING_TONE } from "@/components/ui";
import { useLive } from "@/hooks/useLive";
import { money, moneyUp, pct, pctExact, percent, repaidMoney, share, shortAccount } from "@/lib/format";
import { fetchMarket } from "@/lib/snapshotClient";
import { marketGroup, type MarketSnapshot } from "@/lib/snapshot";
import type { Business } from "@/lib/near/types";
import { isBoughtSample, isStagedLoan, isTeamRun, isTeamSample } from "@/lib/demo";
import { distinctName } from "@/lib/names";
import { auctionEnded, isAlert, standing, type Standing } from "@/lib/status";

/** What needs a decision comes first, then what can be funded. */
const ORDER: Record<Standing, number> = { foreclosable: 0, "sale-ended": 1, auction: 1, foreclosed: 2, behind: 3, funding: 4, current: 5, "no-loan": 6 };

function nextStep(s: Standing) {
  switch (s) {
    case "funding": return "Lend";
    case "foreclosable": return "Take over";
    case "foreclosed":
    case "auction": return "Bid";
    case "sale-ended": return "Complete the sale";
    case "no-loan": return "Buy a check";
    default: return "View";
  }
}

/** "5-minute", "15-second": how often a staged demo loan wants a payment. */
const clockWords = (secs: number) => (secs < 60 ? `${secs}-second` : `${Math.round(secs / 60)}-minute`);

const COLS ="lg:grid-cols-[minmax(0,2.2fr)_minmax(0,1.3fr)_minmax(0,1.6fr)_minmax(0,1fr)_auto]";

export function MarketScreen({ initial }: { initial?: MarketSnapshot }) {
  // One cached server read for the whole market, instead of a burst of RPC calls per visitor.
  const live = useLive(fetchMarket, "market", 10_000, initial);
  const router = useRouter();
  const listed = useMemo(() => live.data?.businesses ?? [], [live.data]);
  const all = useMemo(() => [...listed].sort((a, b) => ORDER[standing(a)] - ORDER[standing(b)]), [listed]);
  // One rule places every business (lib/snapshot.ts marketGroup): featured first; the team's
  // test businesses and the ones visitors started are listed separately, folded.
  const rows = all.filter((b) => marketGroup(b) === "featured");
  const teamTests = all.filter((b) => marketGroup(b) === "team");
  const started = all.filter((b) => marketGroup(b) === "visitors");
  // Numbered against the registry's own order, so "Lookout · demo 2" is the same on every page.
  const nameOf = (b: Business) => distinctName(b, listed);
  const stats = live.data?.stats;
  const now = all.reduce((latest, b) => Math.max(latest, b.now), 0);
  const count = (s: Standing[]) => rows.filter((b) => s.includes(standing(b))).length;
  const raisingCount = count(["funding"]);
  const paying = count(["current"]);
  const alerting = rows.filter((b) => isAlert(standing(b)));
  const alerts = alerting.length;
  const stagedAlerts = alerting.filter((b) => b.current_loan && isStagedLoan(b.current_loan)).length;
  const stagedNote = !stagedAlerts ? "" : stagedAlerts === alerts ? (alerts === 1 ? " (a staged demo)" : " (all staged demos)") : ` (${stagedAlerts} staged ${stagedAlerts === 1 ? "demo" : "demos"})`;
  const noLoan = count(["no-loan"]);
  const finding = [
    `${raisingCount} raising`,
    `${paying} paying on time`,
    `${alerts} ${alerts === 1 ? "needs" : "need"} attention${stagedNote}`,
    ...(noLoan ? [`${noLoan} with no loan`] : []),
  ].join(", ");
  const others = [
    ...(teamTests.length ? [`${teamTests.length} Lien team ${teamTests.length === 1 ? "test" : "tests"}`] : []),
    ...(started.length ? [`${started.length} started by visitors`] : []),
  ];
  const recoveredShare = stats && BigInt(stats.closedDue) > 0n ? share(stats.closedRecovered, stats.closedDue) : null;
  const staged = stats?.staged;
  const stagedClock = staged?.longestWindowSecs ? `a ${clockWords(staged.longestWindowSecs)} clock or faster` : "a fast clock";
  const stagedRecovered = staged && BigInt(staged.closedDue) > 0n ? pct(share(staged.closedRecovered, staged.closedDue)) : null;

  return (
    <div className="space-y-8">
      <PageHead
        title="Market"
        lead={
          // Three lines are reserved while loading, so the Start button does not jump when the words arrive.
          <p data-testid="market-finding" className="min-h-[3lh]">
            {live.loaded
              ? all.length === 0
                ? "No businesses yet. Be the first to start one."
                : `${all.length} ${all.length === 1 ? "business" : "businesses"}. ${rows.length} featured: ${finding}.${others.length ? ` Plus ${others.join(" and ")}.` : ""}`
              : "Loading live data…"}
          </p>
        }
        action={<div className="flex items-center gap-4"><ReopenIntro /><Link href="/create" className="btn btn-primary">Start a business</Link></div>}
      />

      <HowItWorks />

      {live.error && !live.data ? (
        <ErrorState message="The network could not be reached, so the market cannot be shown right now." onRetry={() => void live.refresh()} />
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3" data-testid="market-stats">
            {[
              { label: "Lent out now", tip: "Money lenders have in loans that are running or taken over, across every business on Lien.", value: stats ? money(stats.lentNow) : null },
              { label: "Repaid to lenders, all loans", tip: "Every dollar that has reached lenders, on open and closed loans. It only ever goes up.", value: stats ? money(stats.repaidAllTime) : null },
              { label: "Lent in total", tip: "Everything lenders have ever put into loans that started.", value: stats ? money(stats.lentAllTime) : null },
              {
                label: "Real loans closed",
                tip: `Loans on a real clock, with payments due every few days or weeks, that were paid back in full or taken over. Staged demo loans are counted apart: the team opens them on ${stagedClock} so that visitors can try a takeover, and they fall behind on purpose.`,
                value: stats ? `${stats.loansRepaid} repaid, ${stats.loansTakenOver} taken over` : null,
                note: staged?.takenOver ? `Plus ${staged.takenOver} ${staged.takenOver === 1 ? "takeover" : "takeovers"} of staged demos on ${stagedClock}` : null,
                testId: "stat-closed",
              },
              {
                label: "Lenders recovered",
                tip: `On real loans that have closed, what reached lenders against what those loans owed, including after a takeover and sale.${stagedRecovered ? ` On the staged demos that closed, lenders recovered ${stagedRecovered}.` : ""}`,
                value: stats ? (recoveredShare !== null ? <span title={pctExact(recoveredShare)}>{pct(recoveredShare)}</span> : "No real loan has closed yet") : null,
                note: stats ? (recoveredShare !== null ? "On real loans that closed" : null) : null,
              },
              { label: "Checks sold", tip: "Safety checks every business here has sold and delivered. While a loan is running, each sale repays its lenders first.", value: stats ? stats.checksSold.toLocaleString("en-US") : null },
            ].map((stat) => (
              <div key={stat.label} className="rounded-[16px] bg-[var(--surface)] p-3 sm:p-5" data-testid={"testId" in stat ? stat.testId : undefined}>
                <dt className="text-[13px] leading-snug muted sm:text-[14px]">{stat.label}<Info label={stat.label} tip={stat.tip} /></dt>
                <dd className="num mt-2 text-[18px] sm:text-[26px] leading-tight font-medium tracking-[-0.02em]">{stat.value ?? <span className="skeleton inline-block h-6 w-full max-w-32 align-middle" />}</dd>
                {"note" in stat && stat.note ? <dd className="mt-1 text-[12px] leading-snug text-[var(--ink-2)] sm:text-[13px]" data-testid="stat-note">{stat.note}</dd> : null}
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
                {rows.map((b) => <MarketRow key={b.id} business={b} name={nameOf(b)} onOpen={() => router.push(`/b/${b.id}`)} />)}
              </ul>
            )}
            {teamTests.length ? (
              <Folded testId="team-tests" title={`Lien team tests (${teamTests.length})`} lead="Businesses the Lien team runs to test the product, such as probes and the prompt-injection demo that lender agents must refuse.">
                {teamTests.map((b) => <MarketRow key={b.id} business={b} name={nameOf(b)} onOpen={() => router.push(`/b/${b.id}`)} />)}
              </Folded>
            ) : null}
            {started.length ? (
              <Folded testId="started-by-visitors" title={`Started by visitors (${started.length})`} lead="Businesses people started or bought at auction while trying Lien, with fewer than three different customers so far.">
                {started.map((b) => <MarketRow key={b.id} business={b} name={nameOf(b)} onOpen={() => router.push(`/b/${b.id}`)} />)}
              </Folded>
            ) : null}
          </section>

          {live.loaded && rows.length ? <ActivityFeed items={live.data?.activity ?? []} now={now} /> : null}

          {live.loaded ? <TryIt rows={rows} nameOf={nameOf} /> : null}
          <p className="max-w-[72ch] text-[14px] muted">
            Every figure is read live from the network. No person holds the keys to any business here, so none of this depends on trusting Lien. <Link className="link" href="/proof">See every promise and its proof</Link>.
          </p>
        </>
      )}
    </div>
  );
}

/** A folded list under the featured businesses. */
function Folded({ testId, title, lead, children }: { testId: string; title: string; lead: string; children: React.ReactNode }) {
  return (
    <details className="group rounded-[16px] bg-[var(--surface)]" data-testid={testId}>
      <summary className="flex min-h-[56px] cursor-pointer list-none items-center justify-between gap-3 px-5 text-[16px] font-medium [&::-webkit-details-marker]:hidden">
        {title}
        <span aria-hidden className="text-[var(--muted)] transition-transform group-open:rotate-180">▾</span>
      </summary>
      <p className="px-5 pb-3 text-[14px] text-[var(--ink-2)]">{lead}</p>
      <ul className="space-y-2 px-2 pb-2">{children}</ul>
    </details>
  );
}

/** What a newcomer can do right now, built from the market's real state. */
function TryIt({ rows, nameOf }: { rows: Business[]; nameOf: (b: Business) => string }) {
  const pick = (...states: Standing[]) => rows.find((b) => states.includes(standing(b)));
  const raising = pick("funding");
  const late = pick("foreclosable", "behind");
  const sale = pick("foreclosed", "auction");
  const ended = pick("sale-ended");
  const serving = pick("current") ?? rows[0];
  const steps = [
    raising && { href: `/b/${raising.id}`, action: `Lend to ${nameOf(raising)}`, result: "You get a share of the loan, repaid from every sale it makes." },
    serving && { href: `/b/${serving.id}`, action: `Buy a safety check from ${nameOf(serving)}`, result: "A report on any account, usually in under a minute, sometimes up to two. If it fails, you get your money back." },
    late && { href: `/b/${late.id}`, action: `Take over ${nameOf(late)}`, result: `${late.current_loan && isStagedLoan(late.current_loan) ? "A staged demo: its loan wants a payment every few minutes, so it falls behind on purpose." : "It missed its payments."} Anyone can take it over for its lenders, and it keeps serving customers.` },
    sale && { href: `/b/${sale.id}`, action: `Bid on ${nameOf(sale)}`, result: "The highest bid takes a running business. The price goes to its lenders first." },
    !sale && ended && { href: `/b/${ended.id}`, action: `Complete the sale of ${nameOf(ended)}`, result: "Its auction has ended. Anyone can complete the sale; the price goes to lenders first." },
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

function MarketRow({ business: b, name, onOpen }: { business: Business; name: string; onOpen: () => void }) {
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
        <Link className="text-[17px] font-medium hover:underline" href={`/b/${b.id}`} onClick={(e) => e.stopPropagation()}>{name}</Link>
        <div className="truncate text-[13px] muted" title={b.id}>{isTeamSample(b) ? "Sample by the Lien team" : isTeamRun(b) ? "Run by the Lien team" : isBoughtSample(b) ? `Bought by ${shortAccount(b.operator, 22)}` : shortAccount(b.id, 36)}{loan && isStagedLoan(loan) ? " · staged demo loan" : ""}</div>
      </div>
      <div className="justify-self-end lg:justify-self-start"><StandingLabel standing={s} /></div>
      <div className="col-span-2 min-w-0 lg:col-span-1">
        {loan ? (
          <>
            <div className="mb-2 flex justify-between gap-3 text-[14px]">
              <span className="num">{raising ? `${money(loan.funded)} of ${money(loan.terms.principal)} raised` : `${repaidMoney(loan.terms.total_due, loan.repaid)} of ${money(loan.terms.total_due)} paid back`}</span>
              <span className="num muted" title={pctExact(progress)}>{pct(progress)}</span>
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
