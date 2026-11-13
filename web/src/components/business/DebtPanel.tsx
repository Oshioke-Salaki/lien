"use client";

import { Panel, Term } from "@/components/ui";
import { dateTime, duration, fromNow, money, moneyExact, percent, share } from "@/lib/format";
import { GLOSSARY } from "@/lib/glossary";
import { splitInflow } from "@/lib/math";
import type { Business, LoanView } from "@/lib/near/types";
import { standing } from "@/lib/status";

/** Loans whose payment window is under an hour run on demo clocks, so a visitor can watch them play out. */
export const isDemoClock = (loan: LoanView | null) => !!loan && loan.terms.window_secs < 3_600;

/**
 * The element only this product has: the payment clock. Paid against what the
 * schedule requires, with the moments the contract acts on marked in place.
 */
function PaymentClock({ loan, now }: { loan: LoanView; now: number }) {
  const start = loan.activated_at!;
  const end = loan.maturity ?? start + loan.terms.term_secs;
  const span = Math.max(1, end - start);
  const at = (t: number) => Math.max(0, Math.min(100, ((t - start) / span) * 100));
  const paidPct = share(loan.repaid, loan.terms.total_due);
  const breach = loan.breach_at;
  const foreclosable = loan.foreclosable_at;
  return (
    <div className="mt-5 space-y-3" data-testid="payment-clock">
      <div>
        <div className="mb-2 flex justify-between text-[14px] muted"><span>Paid back to lenders so far</span><span className="num text-[var(--ink)]">{paidPct}%</span></div>
        <div className="track h-[10px]" role="img" aria-label={`${paidPct}% of the debt has been paid`}>
          <i style={{ width: `${paidPct}%` }} />
        </div>
      </div>
      <div>
        <div className="mb-2 flex justify-between text-[14px] muted"><span>Time on the loan</span><span>Ends {dateTime(end)}</span></div>
        <div className="relative h-[10px] rounded-full bg-[var(--surface-3)]" role="img" aria-label={`Term progress: ${Math.round(at(now))}% elapsed`}>
          <div className="h-full rounded-full bg-[var(--ink-2)] transition-[width] duration-1000" style={{ width: `${at(now)}%` }} />
          {breach !== null ? <span className="absolute -inset-y-[3px] w-[3px] rounded-full bg-[var(--warn)]" style={{ left: `${at(breach)}%` }} title="Falls behind if unpaid" /> : null}
          {foreclosable !== null && foreclosable !== breach ? <span className="absolute -inset-y-[3px] w-[3px] rounded-full bg-[var(--danger)]" style={{ left: `${at(foreclosable)}%` }} title="Anyone can take it over" /> : null}
        </div>
        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-[13px] muted">
          {breach !== null ? <span className="flex items-center gap-2"><i aria-hidden className="h-[10px] w-[3px] rounded-full bg-[var(--warn)]" />Falls behind if unpaid</span> : null}
          {foreclosable !== null && foreclosable !== breach ? <span className="flex items-center gap-2"><i aria-hidden className="h-[10px] w-[3px] rounded-full bg-[var(--danger)]" />Anyone can take it over</span> : null}
        </div>
      </div>
    </div>
  );
}

function headline(b: Business, now: number): string {
  const loan = b.current_loan;
  if (!loan) return b.loan_count ? "No open loan. Its last loan has closed." : "This business has never borrowed.";
  const s = standing({ ...b, now });
  switch (s) {
    case "funding": return `Raising money from lenders until ${dateTime(loan.funding_deadline)}. Nobody's money moves until the full amount is raised.`;
    case "current": {
      if (!loan.breach_at) return "Paying on time.";
      const minimum = `the minimum is ${money(loan.terms.min_payment_per_window)} every ${duration(loan.terms.window_secs)}`;
      // Sales can cover several payment windows at once; say so rather than leave the gap unexplained.
      return loan.breach_at - now > loan.terms.window_secs
        ? `Paying on time, and paid ahead: the next payment is due ${fromNow(loan.breach_at, now)} (${minimum}).`
        : `Paying on time. The next payment is due ${fromNow(loan.breach_at, now)} (${minimum}).`;
    }
    case "behind": return `Behind on payments. A payment now puts it back on track; if none comes, anyone can take it over ${fromNow(loan.foreclosable_at!, now)}.`;
    case "foreclosable": return "Missed its payments, and its extra time is up. Anyone can take it over now.";
    case "foreclosed": return "Taken over for its lenders. It keeps selling, and its owner's share of each sale now goes to lenders until it is sold.";
    case "auction": return "Taken over and for sale. The highest bid when the auction ends buys the business.";
    default: return "";
  }
}

function DemoNote({ loan }: { loan: LoanView }) {
  return (
    <p className="mt-4 rounded-[10px] bg-[var(--surface-2)] px-4 py-3 text-[14px] text-[var(--ink-2)]" data-testid="demo-clock">
      Demo loan: it runs on a fast clock (a payment is due every {duration(loan.terms.window_secs)}) so you can watch a takeover happen in about a minute. Real loans run over weeks.
    </p>
  );
}

export function DebtPanel({ business: b, now }: { business: Business; now: number }) {
  const loan = b.current_loan;
  if (!loan) {
    const revenue = BigInt(b.stats.job_revenue) + BigInt(b.stats.external_revenue);
    return (
      <Panel>
        <p className="text-[17px] leading-snug" data-testid="headline">{headline(b, now)}</p>
        <p className="num mt-5 text-[clamp(40px,5vw,56px)] leading-none font-medium tracking-[-0.03em]">{money(revenue)} <span className="text-[17px] font-normal tracking-normal muted">earned from sales</span></p>
      </Panel>
    );
  }
  const raising = loan.status === "Funding";
  return (
    <Panel>
      <p className="text-[17px] leading-snug" data-testid="headline">{headline(b, now)}</p>
      <div className="mt-6 flex flex-wrap items-end justify-between gap-x-10 gap-y-3">
        <div>
          <p className="text-[14px] muted">{raising ? "Still to raise" : "Still owed to lenders"}</p>
          <p className="num mt-1 text-[clamp(44px,5.4vw,64px)] leading-none font-medium tracking-[-0.03em]" data-testid="big-figure">
            {money(raising ? BigInt(loan.terms.principal) - BigInt(loan.funded) : loan.outstanding)}
          </p>
        </div>
        <dl className="num grid grid-cols-[auto_auto] gap-x-6 gap-y-2 text-[15px]">
          <dt className="muted">{raising ? "Raised" : "Paid back"}</dt>
          <dd className="text-right">{money(raising ? loan.funded : loan.repaid)}</dd>
          <dt className="muted">{raising ? "Goal" : "Total to repay"}</dt>
          <dd className="text-right">{money(raising ? loan.terms.principal : loan.terms.total_due)}</dd>
          <dt className="muted">Lenders</dt>
          <dd className="text-right">{loan.holders}</dd>
        </dl>
      </div>
      {raising ? (
        <div className="mt-6"><div className="mb-2 flex justify-between text-[14px] muted"><span>Raised</span><span className="num text-[var(--ink)]">{share(loan.funded, loan.terms.principal)}%</span></div><div className="track h-[10px]" role="img" aria-label={`${share(loan.funded, loan.terms.principal)}% raised`}>
          <i style={{ width: `${share(loan.funded, loan.terms.principal)}%` }} />
        </div></div>
      ) : <PaymentClock loan={loan} now={now} />}
      {isDemoClock(loan) ? <DemoNote loan={loan} /> : null}
    </Panel>
  );
}

/** Where each sale goes, using the contract's own rule on the price of one job. */
export function WaterfallPanel({ business: b, now }: { business: Business; now: number }) {
  const loan = b.current_loan;
  const price = BigInt(b.service.price);
  const open = loan && (loan.status === "Active" || loan.status === "Foreclosed");
  const raising = loan?.status === "Funding";
  const s = standing({ ...b, now });
  const trapped = s === "behind" || s === "foreclosable" || s === "foreclosed" || s === "auction";
  // While raising, show the split the lenders agreed to, as it will run once the loan starts.
  const split = open || raising
    ? splitInflow(price, raising ? BigInt(loan!.terms.total_due) : BigInt(loan!.outstanding), loan!.terms.lender_bps, loan!.terms.operator_bps, trapped)
    : { lender: 0n, operator: 0n, opex: price };
  const parts = [
    { key: "Lenders", value: split.lender, color: "var(--accent)" },
    { key: "Owner", value: split.operator, color: "var(--ink-2)" },
    { key: "Kept for running costs", value: split.opex, color: "#6b6158" },
  ];
  const aside = trapped ? "The owner's share goes to lenders now" : raising ? "Once the loan starts" : !loan ? "No loan, so nothing goes to lenders" : undefined;
  return (
    <Panel title={`Where each ${money(price)} sale goes`} aside={aside}>
      <div className="flex h-9 gap-[3px] overflow-hidden rounded-[8px]" role="img" aria-label={parts.map((p) => `${p.key} ${moneyExact(p.value)}`).join(", ")}>
        {parts.filter((p) => p.value > 0n).map((p) => (
          <div key={p.key} className="transition-[flex-grow] duration-700" style={{ flexGrow: Number(p.value), background: p.color }} />
        ))}
      </div>
      <dl className="mt-4 grid grid-cols-1 gap-x-8 gap-y-2 text-[15px] sm:grid-cols-3">
        {parts.map((p) => (
          <div key={p.key} className="flex items-baseline justify-between gap-3 sm:block">
            <dt className="flex items-center gap-2 muted"><span aria-hidden className="h-[10px] w-[10px] shrink-0 rounded-[3px]" style={{ background: p.color }} />{p.key}</dt>
            <dd className="num text-[18px] font-medium sm:mt-1">{moneyExact(p.value)}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-4 text-[14px] text-[var(--ink-2)]">The contract splits every sale the moment it is paid. Nobody, not even the owner, can change this during the loan.</p>
    </Panel>
  );
}

export function TermsPanel({ business: b }: { business: Business }) {
  const loan = b.current_loan;
  if (!loan) return null;
  const t = loan.terms;
  const interest = BigInt(t.total_due) - BigInt(t.principal);
  return (
    <Panel title="Loan terms" aside={`Loan ${loan.id + 1}`}>
      <dl className="dl" data-testid="terms">
        <dt>Borrowed</dt><dd>{money(t.principal)}</dd>
        <dt>Interest, fixed</dt><dd>{money(interest)} ({percent(Number((interest * 10_000n) / BigInt(t.principal)))})</dd>
        <dt>Lenders get</dt><dd>{percent(t.lender_bps)} of every sale</dd>
        <dt><Term tip={GLOSSARY.owner}>Owner</Term> gets</dt><dd>{percent(t.operator_bps)} of every sale</dd>
        <dt><Term tip={GLOSSARY.minimumPayment}>Minimum payment</Term></dt><dd>{money(t.min_payment_per_window)} every {duration(t.window_secs)}</dd>
        <dt>Length of the loan</dt><dd>{duration(t.term_secs)}</dd>
        <dt><Term tip={GLOSSARY.grace}>Extra time</Term> before a takeover</dt><dd>{duration(t.grace_secs)}</dd>
        <dt><Term tip={GLOSSARY.auction}>Auction</Term> length</dt><dd>{duration(t.auction_secs)}</dd>
        <dt>Lowest first bid</dt><dd>{percent(t.auction_reserve_bps)} of the debt</dd>
      </dl>
    </Panel>
  );
}
