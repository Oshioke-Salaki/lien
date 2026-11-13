"use client";

import { useMemo, useState } from "react";
import { useTx } from "@/components/Tx";
import { duration, money, unitName } from "@/lib/format";
import { amountProblem, parseMoney } from "@/lib/amounts";
import { projectPayoff } from "@/lib/math";
import { bpsFrom, minimumWarning, validateTerms } from "@/lib/terms";
import { createOffer } from "@/lib/near/actions";
import type { Business, LoanTerms } from "@/lib/near/types";
import { AmountField, DurationField, TextField } from "./fields";

const DAY = 86_400;
const PRESETS = {
  standard: { funding: 7 * DAY, term: 90 * DAY, window: 7 * DAY, grace: 3 * DAY, auction: 7 * DAY },
  // Short clocks, for seeing the whole lifecycle in one sitting.
  demo: { funding: DAY, term: DAY, window: 300, grace: 300, auction: 300 },
};

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
    const p = parseMoney(principal);
    const rate = bpsFrom(interest);
    const l = bpsFrom(lender);
    const o = bpsFrom(operator);
    const r = bpsFrom(reserve);
    const m = parseMoney(minPayment === "" ? "0" : minPayment);
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

  const interestValue = Number(interest);
  const shareValues = [lender, operator, reserve].map(Number);
  const termsProblem = Number.isFinite(interestValue) && interestValue > 100 ? "Interest can be at most 100% on the test network."
    : interest.trim() === "" || !Number.isFinite(interestValue) || interestValue < 0 ? "Interest: a percentage, like 10."
    : shareValues.some((v) => !Number.isFinite(v) || v < 0 || v > 100) ? "Shares and the lowest first bid are percentages from 0 to 100."
    : terms ? validateTerms(terms) : "Amounts: dollars with at most two decimals, like 100 or 12.50.";
  const warning = terms ? minimumWarning(terms) : null;
  const revenuePerWindow = parseMoney(revenue);
  const projection = terms && revenuePerWindow !== null ? projectPayoff({
    totalDue: BigInt(terms.total_due),
    lenderBps: terms.lender_bps,
    revenuePerWindow,
    windowSecs: terms.window_secs,
    minPaymentPerWindow: BigInt(terms.min_payment_per_window),
    termSecs: terms.term_secs,
  }) : null;
  // The offer must work at the revenue the owner expects, or it is set up to fail.
  const problem = termsProblem
    ?? (projection && !projection.meetsMinimum ? "At the revenue you expect, lenders would get less than your minimum payment. Lower the minimum, raise lenders' share, or check the revenue." : null)
    ?? (projection && projection.meetsMinimum && !projection.paysBeforeMaturity ? "At the revenue you expect, the debt wouldn't clear before the term ends. Lengthen the term or raise lenders' share." : null);

  // Terms that leave lenders exposed: allowed, but only once the owner says they understand.
  const reserveValue = Number(reserve);
  const risky = [
    Number.isFinite(reserveValue) && reserveValue < 50 ? `A lowest first bid of ${reserveValue}% lets the business sell for well under its debt, so lenders could recover little.` : null,
    times.grace === 0 ? "No extra time means one late payment lets anyone take it over at once." : null,
  ].filter(Boolean) as string[];
  const [understood, setUnderstood] = useState(false);
  const blocked = !!problem || (risky.length > 0 && !understood);

  const submit = async () => {
    if (!terms || blocked) return;
    await run(createOffer(b.id, terms), { requiredOn: b.id, done: "Your offer is open to lenders" });
    await refresh();
  };

  return (
    <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void submit(); }} data-testid="offer-form">
      <div className="flex gap-2 text-[14px]">
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => setTimes(PRESETS.standard)}>90 day loan</button>
        <button type="button" className="btn btn-secondary btn-sm" data-testid="preset-demo" onClick={() => setTimes(PRESETS.demo)}>Short demo clocks</button>
      </div>
      <AmountField label="Borrow" value={principal} onChange={setPrincipal} testId="offer-principal" error={amountProblem(principal)} hint="Up to $100,000 on the test network." />
      <div className="grid grid-cols-2 gap-3">
        <TextField label="Interest, %" value={interest} onChange={setInterest} />
        <AmountField label="Minimum payment" value={minPayment} onChange={setMinPayment} testId="offer-min" error={amountProblem(minPayment)} />
        <TextField label="Lenders' share of sales, %" value={lender} onChange={setLender} />
        <TextField label="Your share of sales, %" value={operator} onChange={setOperator} />
      </div>
      <div className="grid grid-cols-1 gap-3">
        <DurationField label="Payment period" testId="offer-window" secs={times.window} onChange={(window) => setTimes({ ...times, window })} />
        <DurationField label="Length of the loan" secs={times.term} onChange={(term) => setTimes({ ...times, term })} />
        <DurationField label="Extra time before a takeover" testId="offer-grace" secs={times.grace} onChange={(grace) => setTimes({ ...times, grace })} />
        <DurationField label="Raising period" secs={times.funding} onChange={(funding) => setTimes({ ...times, funding })} />
        <DurationField label="Auction" secs={times.auction} onChange={(auction) => setTimes({ ...times, auction })} />
        <TextField label="Lowest first bid, % of debt" value={reserve} onChange={setReserve} />
      </div>

      <div className="inset space-y-2 text-[15px]" data-testid="offer-preview">
        <AmountField label={`If you earn this much every ${duration(times.window)}`} value={revenue} onChange={setRevenue} error={amountProblem(revenue)} />
        {terms && projection && BigInt(terms.principal) > 0n ? (
          <>
            <p>Lenders put in {money(terms.principal)} and get back {money(terms.total_due)}.</p>
            {/* The payoff line only when the terms work; otherwise the problem below says what to change. */}
            {projection.meetsMinimum && projection.paysBeforeMaturity && !termsProblem ? (
              <p>{money(projection.perWindow)} reaches lenders each period{projection.payoffSecs !== null ? (projection.payoffSecs > 10 * 365 * DAY ? ", which would take more than ten years to clear the debt" : `, clearing the debt in ${duration(projection.payoffSecs)}`) : ""}.</p>
            ) : <p>{money(projection.perWindow)} would reach lenders each period.</p>}
            {!projection.meetsMinimum ? <p className="text-[var(--danger)]">That is below your minimum payment. You would fall behind, and anyone could take the business over.</p> : null}
            {projection.meetsMinimum && !projection.paysBeforeMaturity ? <p className="text-[var(--danger)]">It would not clear before the loan ends, and that end is a hard deadline.</p> : null}
            <p className="muted">The price of a job is {money(b.service.price)}, and the code, price and vendors freeze as soon as you submit.</p>
          </>
        ) : null}
      </div>

      {problem ? <p className="hint" data-error="true">{problem}</p> : warning ? <p className="hint" data-testid="offer-warning">{warning}</p> : null}
      {!problem && risky.length ? (
        <div className="rounded-[12px] bg-[var(--warn-bg,#2a2114)] p-4 text-[15px]" data-testid="offer-risk">
          <p className="font-medium">These terms leave your lenders exposed</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">{risky.map((r) => <li key={r}>{r}</li>)}</ul>
          <label className="mt-3 flex items-center gap-2">
            <input type="checkbox" checked={understood} onChange={(e) => setUnderstood(e.target.checked)} />
            <span>I understand, and lenders will see these terms before they lend</span>
          </label>
        </div>
      ) : null}
      <button type="submit" className="btn btn-primary w-full" disabled={busy || blocked} data-testid="offer-submit">Open this offer to lenders</button>
      <p className="hint">{`All amounts in ${unitName}.`}</p>
    </form>
  );
}
