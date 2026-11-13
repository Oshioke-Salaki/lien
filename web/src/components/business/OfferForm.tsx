"use client";

import { useMemo, useState } from "react";
import { useTx } from "@/components/Tx";
import { duration, money, parseAmount, unitName } from "@/lib/format";
import { projectPayoff } from "@/lib/math";
import { createOffer } from "@/lib/near/actions";
import type { Business, LoanTerms } from "@/lib/near/types";
import { AmountField, DurationField, TextField } from "./fields";

const DAY = 86_400;
const PRESETS = {
  standard: { funding: 7 * DAY, term: 90 * DAY, window: 7 * DAY, grace: 3 * DAY, auction: 7 * DAY },
  // Short clocks, for seeing the whole lifecycle in one sitting.
  demo: { funding: DAY, term: DAY, window: 300, grace: 300, auction: 300 },
};

function bpsFrom(text: string): number | null {
  const n = Number(text);
  return Number.isFinite(n) && n >= 0 && n <= 100 ? Math.round(n * 100) : null;
}

/** Everything the contract's `validate::terms` refuses, caught before signing. */
export function validateTerms(t: LoanTerms): string | null {
  const principal = BigInt(t.principal);
  const due = BigInt(t.total_due);
  if (principal <= 0n) return "Enter how much to borrow.";
  if (due < principal) return "Interest cannot be negative.";
  if (t.lender_bps <= 0) return "Lenders must receive a share of revenue.";
  if (t.lender_bps + t.operator_bps > 10_000) return "Lenders' share and yours cannot add up to more than 100%.";
  if (t.auction_reserve_bps > 10_000) return "The reserve cannot exceed 100%.";
  for (const [value, name] of [[t.funding_secs, "Raising period"], [t.term_secs, "Term"], [t.window_secs, "Payment period"], [t.auction_secs, "Auction"]] as const) {
    if (value <= 0) return `${name} must be longer than zero.`;
    if (value > 10 * 365 * DAY) return `${name} can be at most ten years.`;
  }
  if (t.window_secs > t.term_secs) return "The payment period cannot be longer than the term.";
  if (BigInt(t.min_payment_per_window) > due) return "The minimum payment cannot exceed the total due.";
  return null;
}

export function OfferForm({ business: b, refresh }: { business: Business; refresh: () => Promise<void> }) {
  const { run, busy } = useTx();
  const [principal, setPrincipal] = useState("100");
  const [interest, setInterest] = useState("10");
  const [lender, setLender] = useState("30");
  const [operator, setOperator] = useState("20");
  const [minPayment, setMinPayment] = useState("5");
  const [reserve, setReserve] = useState("50");
  const [revenue, setRevenue] = useState("50");
  const [times, setTimes] = useState(PRESETS.standard);

  const terms = useMemo<LoanTerms | null>(() => {
    const p = parseAmount(principal);
    const rate = bpsFrom(interest);
    const l = bpsFrom(lender);
    const o = bpsFrom(operator);
    const r = bpsFrom(reserve);
    const m = parseAmount(minPayment === "" ? "0" : minPayment);
    if (p === null || rate === null || l === null || o === null || r === null || m === null) return null;
    return {
      principal: p.toString(),
      total_due: (p + (p * BigInt(rate)) / 10_000n).toString(),
      lender_bps: l,
      operator_bps: o,
      funding_secs: times.funding,
      term_secs: times.term,
      window_secs: times.window,
      min_payment_per_window: m.toString(),
      grace_secs: times.grace,
      auction_secs: times.auction,
      auction_reserve_bps: r,
    };
  }, [principal, interest, lender, operator, reserve, minPayment, times]);

  const problem = terms ? validateTerms(terms) : "Check the numbers above.";
  const revenuePerWindow = parseAmount(revenue);
  const projection = terms && revenuePerWindow !== null ? projectPayoff({
    totalDue: BigInt(terms.total_due),
    lenderBps: terms.lender_bps,
    revenuePerWindow,
    windowSecs: terms.window_secs,
    minPaymentPerWindow: BigInt(terms.min_payment_per_window),
    termSecs: terms.term_secs,
  }) : null;

  const submit = async () => {
    if (!terms || problem) return;
    await run(createOffer(b.id, terms), { requiredOn: b.id, done: "Your offer is open to lenders" });
    await refresh();
  };

  return (
    <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void submit(); }} data-testid="offer-form">
      <div className="flex gap-2 text-[14px]">
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => setTimes(PRESETS.standard)}>90 day loan</button>
        <button type="button" className="btn btn-secondary btn-sm" data-testid="preset-demo" onClick={() => setTimes(PRESETS.demo)}>Short demo clocks</button>
      </div>
      <AmountField label="Borrow" value={principal} onChange={setPrincipal} testId="offer-principal" />
      <div className="grid grid-cols-2 gap-3">
        <TextField label="Interest, %" value={interest} onChange={setInterest} />
        <AmountField label="Minimum payment" value={minPayment} onChange={setMinPayment} testId="offer-min" />
        <TextField label="Lenders' share of sales, %" value={lender} onChange={setLender} />
        <TextField label="Your share of sales, %" value={operator} onChange={setOperator} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <DurationField label="Payment period" testId="offer-window" secs={times.window} onChange={(window) => setTimes({ ...times, window })} />
        <DurationField label="Term" secs={times.term} onChange={(term) => setTimes({ ...times, term })} />
        <DurationField label="Grace" testId="offer-grace" secs={times.grace} onChange={(grace) => setTimes({ ...times, grace })} />
        <DurationField label="Raising period" secs={times.funding} onChange={(funding) => setTimes({ ...times, funding })} />
        <DurationField label="Auction" secs={times.auction} onChange={(auction) => setTimes({ ...times, auction })} />
        <TextField label="Lowest first bid, % of debt" value={reserve} onChange={setReserve} />
      </div>

      <div className="inset space-y-2 text-[15px]" data-testid="offer-preview">
        <AmountField label={`If you earn this much every ${duration(times.window)}`} value={revenue} onChange={setRevenue} />
        {terms && projection ? (
          <>
            <p>Lenders put in {money(terms.principal)} and get back {money(terms.total_due)}.</p>
            <p>{money(projection.perWindow)} reaches lenders each period{projection.payoffSecs !== null ? `, clearing the debt in ${duration(projection.payoffSecs)}` : ""}.</p>
            {!projection.meetsMinimum ? <p className="text-[var(--danger)]">That is below your minimum payment. You would fall behind, and anyone could take the business over.</p> : null}
            {projection.meetsMinimum && !projection.paysBeforeMaturity ? <p className="text-[var(--danger)]">It would not clear before the term ends, and the term end is a hard deadline.</p> : null}
            <p className="muted">The price of a job is {money(b.service.price)}, and the code, price and vendors freeze as soon as you submit.</p>
          </>
        ) : null}
      </div>

      {problem ? <p className="hint" data-error="true">{problem}</p> : null}
      <button type="submit" className="btn btn-primary w-full" disabled={busy || !!problem} data-testid="offer-submit">Open this offer to lenders</button>
      <p className="hint">{`All amounts in ${unitName}.`}</p>
    </form>
  );
}
