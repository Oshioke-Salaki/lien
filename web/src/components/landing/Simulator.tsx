"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { splitInflow } from "@/lib/math";

const USD = 1_000_000n;
const PRINCIPAL = 1_000n * USD;
const TOTAL_DUE = 1_100n * USD;
const OPERATOR_BPS = 2_000;
const MONTHS_BEFORE_STOP = 3;

const dollars = (value: bigint) => `$${(value / USD).toLocaleString("en-US")}`;

function Slider({ id, label, value, min, max, step, onChange, display }: { id: string; label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; display: string }) {
  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between gap-4 text-[16px]">
        <label htmlFor={id}>{label}</label>
        <output htmlFor={id} className="num font-medium">{display}</output>
      </div>
      <input id={id} data-testid={id} type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="h-11 w-full cursor-pointer accent-black" />
    </div>
  );
}

/**
 * The page's live thing, using the contract's own waterfall rule. Set the terms,
 * then stop the payments and watch the record become a notice.
 */
export function Simulator() {
  const [revenue, setRevenue] = useState(800);
  const [lenderShare, setLenderShare] = useState(30);
  const [stopped, setStopped] = useState(false);
  const [bid, setBid] = useState(500);

  const model = useMemo(() => {
    const monthly = BigInt(revenue) * USD;
    const split = splitInflow(monthly, TOTAL_DUE, lenderShare * 100, OPERATOR_BPS, false);
    const months = split.lender > 0n ? Number((TOTAL_DUE + split.lender - 1n) / split.lender) : Infinity;
    const paidBeforeStop = split.lender * BigInt(MONTHS_BEFORE_STOP);
    const repaid = paidBeforeStop < TOTAL_DUE ? paidBeforeStop : TOTAL_DUE;
    const outstanding = TOTAL_DUE - repaid;
    const trapped = splitInflow(monthly, outstanding, lenderShare * 100, OPERATOR_BPS, true);
    const price = BigInt(bid) * USD;
    const toLenders = price < outstanding ? price : outstanding;
    const recovered = repaid + toLenders;
    return { split, months, repaid, outstanding, trapped, price, toLenders, surplus: price - toLenders, recovered };
  }, [revenue, lenderShare, bid]);

  const clearsAnyway = stopped && model.outstanding === 0n;
  const noticed = stopped && !clearsAnyway;

  return (
    <section id="try" aria-labelledby="try-title" className="lg:grid lg:grid-cols-[50%_1fr]">
      <div className="sticky top-0 z-10 flex h-[46svh] items-center justify-center overflow-hidden px-4 transition-colors duration-700 lg:h-svh" style={{ background: noticed ? "var(--accent)" : "var(--sage)", transitionTimingFunction: "var(--ease-out)" }}>
        <div data-ui data-testid="notice" data-state={noticed ? "foreclosed" : "active"} className="relative w-full max-w-[440px] origin-center scale-[0.72] bg-white p-6 text-[15px] sm:scale-90 lg:scale-100">
          <p className="text-[24px] leading-tight font-medium tracking-[-0.01em]">{noticed ? "Notice of foreclosure" : clearsAnyway ? "Lien released" : "Record of lien"}</p>
          <p className="mt-1 muted">sentinel, an AI business on NEAR</p>
          <dl className="dl mt-4">
            <dt>Lent</dt><dd>{dollars(PRINCIPAL)}</dd>
            <dt>Owed in total</dt><dd>{dollars(TOTAL_DUE)}</dd>
            {!stopped ? (
              <>
                <dt>Lenders get each month</dt><dd data-testid="monthly-lender">{dollars(model.split.lender)}</dd>
                <dt>Operator gets</dt><dd>{dollars(model.split.operator)}</dd>
                <dt>Stays in the business</dt><dd>{dollars(model.split.opex)}</dd>
                <dt>Paid off in</dt><dd data-testid="payoff">{Number.isFinite(model.months) ? `${model.months} ${model.months === 1 ? "month" : "months"}` : "never"}</dd>
              </>
            ) : (
              <>
                <dt>Paid before stopping</dt><dd>{dollars(model.repaid)}</dd>
                <dt>Still owed</dt><dd data-testid="still-owed">{dollars(model.outstanding)}</dd>
                <dt>Sale price</dt><dd>{dollars(model.price)}</dd>
                <dt>Lenders recover</dt><dd data-testid="recovered">{dollars(model.recovered)}</dd>
                <dt>Former operator gets</dt><dd>{dollars(model.surplus)}</dd>
              </>
            )}
          </dl>
          <p className="mt-4 border-t border-[var(--line)] pt-3">
            {noticed ? "The address, the inbox and the service stay exactly as they were. Only the owner changes." : clearsAnyway ? "The debt cleared before payments stopped, so the operator keeps everything." : "Current. Nobody holds a key to this business."}
          </p>
          {noticed ? (
            <span className="stamp-in absolute top-5 right-5 border-[3px] border-black px-2 py-1 text-[14px] font-semibold" aria-hidden>Foreclosed</span>
          ) : null}
        </div>
      </div>

      <div className="space-y-[20svh] px-[var(--margin)] py-16 lg:space-y-[34svh] lg:px-[8%] lg:py-[20svh]">
        <div>
          <h2 id="try-title" className="text-[var(--step-head)] leading-[1.05] font-medium tracking-[-0.02em]" data-reveal>Now stop the payments</h2>
          <p className="mt-5 text-[var(--step-body)]" data-reveal style={{ "--d": 1 } as React.CSSProperties}>A $1,000 loan to a business that sells checks. The rule that runs here is the one in the contract.</p>
        </div>
        <div className="max-w-[44ch] space-y-4" data-reveal>
          <p className="text-[28px] leading-tight font-medium tracking-[-0.01em]">Revenue repays the debt on its own.</p>
          <p className="text-[17px]">Lenders are paid from each sale before anyone else, so nobody has to remember to pay.</p>
          <Slider id="sim-revenue" label="Revenue per month" value={revenue} min={100} max={4000} step={100} onChange={setRevenue} display={`$${revenue.toLocaleString("en-US")}`} />
        </div>
        <div className="max-w-[44ch] space-y-4" data-reveal>
          <p className="text-[28px] leading-tight font-medium tracking-[-0.01em]">The split is fixed before a cent moves.</p>
          <p className="text-[17px]">Operators offer it, lenders accept it, and the contract enforces it for the life of the loan.</p>
          <Slider id="sim-share" label="Lenders' share of each sale" value={lenderShare} min={5} max={80} step={5} onChange={setLenderShare} display={`${lenderShare}%`} />
        </div>
        <div className="max-w-[44ch] space-y-4" data-reveal>
          <p className="text-[28px] leading-tight font-medium tracking-[-0.01em]">After three months, it stops paying.</p>
          <p className="text-[17px]">Once the grace period ends, a stranger can foreclose. There is no admin to ask.</p>
          <button type="button" data-testid="sim-stop" aria-pressed={stopped} className={`btn w-full ${stopped ? "btn-secondary" : "btn-primary"}`} onClick={() => setStopped(!stopped)}>
            {stopped ? "Start paying again" : "Stop the payments"}
          </button>
        </div>
        <div className="max-w-[44ch] space-y-4" data-reveal>
          <p className="text-[28px] leading-tight font-medium tracking-[-0.01em]">Someone buys a running business.</p>
          <p className="text-[17px]">The price pays lenders first. Anything above the debt goes back to the former operator, like any foreclosure.</p>
          <Slider id="sim-bid" label="Winning bid" value={bid} min={100} max={1500} step={50} onChange={(v) => { setBid(v); setStopped(true); }} display={`$${bid.toLocaleString("en-US")}`} />
          <Link href="/market" className="link inline-block text-[17px]">Do it for real on testnet</Link>
        </div>
      </div>
    </section>
  );
}
