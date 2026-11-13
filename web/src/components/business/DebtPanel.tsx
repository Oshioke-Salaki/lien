"use client";

import { Panel } from "@/components/ui";
import { dateTime, duration, fromNow, money, percent, share, smartAmount, symbol } from "@/lib/format";
import { splitInflow } from "@/lib/math";
import type { Business, LoanView } from "@/lib/near/types";
import { standing } from "@/lib/status";

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
        <div className="mb-2 flex justify-between text-[14px] muted"><span>Paid to lenders</span><span className="num text-[var(--ink)]">{paidPct}%</span></div>
        <div className="track h-[10px]" role="img" aria-label={`${paidPct}% of the debt has been paid`}>
          <i style={{ width: `${paidPct}%` }} />
        </div>
      </div>
      <div>
        <div className="mb-2 flex justify-between text-[14px] muted"><span>Term</span><span>Ends {dateTime(end)}</span></div>
        <div className="relative h-[10px] rounded-full bg-[var(--surface-3)]" role="img" aria-label={`Term progress: ${Math.round(at(now))}% elapsed`}>
          <div className="h-full rounded-full bg-[var(--ink-2)] transition-[width] duration-1000" style={{ width: `${at(now)}%` }} />
          {breach !== null ? <span className="absolute -inset-y-[3px] w-[3px] rounded-full bg-[var(--warn)]" style={{ left: `${at(breach)}%` }} title="Falls behind" /> : null}
          {foreclosable !== null && foreclosable !== breach ? <span className="absolute -inset-y-[3px] w-[3px] rounded-full bg-[var(--danger)]" style={{ left: `${at(foreclosable)}%` }} title="Can be foreclosed" /> : null}
        </div>
        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-[13px] muted">
          {breach !== null ? <span className="flex items-center gap-2"><i aria-hidden className="h-[10px] w-[3px] rounded-full bg-[var(--warn)]" />Falls behind</span> : null}
          {foreclosable !== null && foreclosable !== breach ? <span className="flex items-center gap-2"><i aria-hidden className="h-[10px] w-[3px] rounded-full bg-[var(--danger)]" />Can be foreclosed</span> : null}
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
    case "funding": return `Raising until ${dateTime(loan.funding_deadline)}. Nothing moves until it is fully funded.`;
    case "current": return loan.breach_at ? `Paying on time. The next payment is due ${fromNow(loan.breach_at, now)}.` : "Paying on time.";
    case "behind": return `Behind on payments. A payment now clears it; anyone can foreclose ${fromNow(loan.foreclosable_at!, now)}.`;
    case "foreclosable": return "Behind and out of grace. Anyone can foreclose this business right now.";
    case "foreclosed": return "In foreclosure. It keeps serving customers, and the operator's share now goes to lenders.";
    case "auction": return "In foreclosure and for sale. The highest bid takes the business when the auction ends.";
    default: return "";
  }
}

export function DebtPanel({ business: b, now }: { business: Business; now: number }) {
  const loan = b.current_loan;
  if (!loan) {
    const revenue = BigInt(b.stats.job_revenue) + BigInt(b.stats.external_revenue);
    return (
      <Panel>
        <p className="text-[17px] leading-snug" data-testid="headline">{headline(b, now)}</p>
        <p className="num mt-5 text-[clamp(40px,5vw,56px)] leading-none font-medium tracking-[-0.03em]">{smartAmount(revenue)} <span className="text-[17px] font-normal tracking-normal muted">{symbol} earned</span></p>
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
            {smartAmount(raising ? BigInt(loan.terms.principal) - BigInt(loan.funded) : loan.outstanding)} <span className="text-[17px] font-normal tracking-normal muted">{symbol}</span>
          </p>
        </div>
        <dl className="num grid grid-cols-[auto_auto] gap-x-6 gap-y-2 text-[15px]">
          <dt className="muted">{raising ? "Raised" : "Paid"}</dt>
          <dd className="text-right">{smartAmount(raising ? loan.funded : loan.repaid)}</dd>
          <dt className="muted">{raising ? "Goal" : "Total due"}</dt>
          <dd className="text-right">{smartAmount(raising ? loan.terms.principal : loan.terms.total_due)}</dd>
          <dt className="muted">Lenders</dt>
          <dd className="text-right">{loan.holders}</dd>
        </dl>
      </div>
      {raising ? (
        <div className="mt-6"><div className="mb-2 flex justify-between text-[14px] muted"><span>Raised</span><span className="num text-[var(--ink)]">{share(loan.funded, loan.terms.principal)}%</span></div><div className="track h-[10px]" role="img" aria-label={`${share(loan.funded, loan.terms.principal)}% raised`}>
          <i style={{ width: `${share(loan.funded, loan.terms.principal)}%` }} />
        </div></div>
      ) : <PaymentClock loan={loan} now={now} />}
    </Panel>
  );
}

/** Where each sale goes right now, using the contract's own rule on the price of one job. */
export function WaterfallPanel({ business: b, now }: { business: Business; now: number }) {
  const loan = b.current_loan;
  const price = BigInt(b.service.price);
  const open = loan && (loan.status === "Active" || loan.status === "Foreclosed");
  const s = standing({ ...b, now });
  const trapped = s === "behind" || s === "foreclosable" || s === "foreclosed" || s === "auction";
  const split = open
    ? splitInflow(price, BigInt(loan.outstanding), loan.terms.lender_bps, loan.terms.operator_bps, trapped)
    : { lender: 0n, operator: 0n, opex: price };
  const parts = [
    { key: "Lenders", value: split.lender, color: "var(--accent)" },
    { key: "Operator", value: split.operator, color: "var(--ink-2)" },
    { key: "Working capital", value: split.opex, color: "#6b6158" },
  ];
  return (
    <Panel title={`Where a ${smartAmount(price)} ${symbol} sale goes`} aside={trapped ? "Operator's share is locked" : undefined}>
      <div className="flex h-9 gap-[3px] overflow-hidden rounded-[8px]" role="img" aria-label={parts.map((p) => `${p.key} ${smartAmount(p.value)}`).join(", ")}>
        {parts.filter((p) => p.value > 0n).map((p) => (
          <div key={p.key} className="transition-[flex-grow] duration-700" style={{ flexGrow: Number(p.value), background: p.color }} />
        ))}
      </div>
      <dl className="mt-4 grid grid-cols-1 gap-x-8 gap-y-2 text-[15px] sm:grid-cols-3">
        {parts.map((p) => (
          <div key={p.key} className="flex items-baseline justify-between gap-3 sm:block">
            <dt className="flex items-center gap-2 muted"><span aria-hidden className="h-[10px] w-[10px] rounded-[3px]" style={{ background: p.color }} />{p.key}</dt>
            <dd className="num text-[18px] font-medium sm:mt-1">{smartAmount(p.value)} {symbol}</dd>
          </div>
        ))}
      </dl>
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
        <dt>Operator gets</dt><dd>{percent(t.operator_bps)} of every sale</dd>
        <dt>Minimum payment</dt><dd>{money(t.min_payment_per_window)} every {duration(t.window_secs)}</dd>
        <dt>Term</dt><dd>{duration(t.term_secs)}</dd>
        <dt>Grace before foreclosure</dt><dd>{duration(t.grace_secs)}</dd>
        <dt>Auction length</dt><dd>{duration(t.auction_secs)}</dd>
        <dt>Lowest first bid</dt><dd>{percent(t.auction_reserve_bps)} of the debt</dd>
      </dl>
    </Panel>
  );
}
