"use client";

import { useEffect, useState } from "react";
import { ConnectButtons, ConnectGate as Gate, useTx } from "@/components/Tx";
import { Panel, Term } from "@/components/ui";
import { usePay } from "@/hooks/usePay";
import { useLive } from "@/hooks/useLive";
import { isTestnet } from "@/lib/config";
import { amount, duration, fromNow, money, nearAmount, parseAmount, percent, share, toYocto } from "@/lib/format";
import { GLOSSARY } from "@/lib/glossary";
import * as tx from "@/lib/near/actions";
import { getCredit, getJob, getLoans, getNote } from "@/lib/near/rpc";
import type { Business, Job, LoanView, NoteView } from "@/lib/near/types";
import { auctionEnded, standing } from "@/lib/status";
import { useWallet } from "@/lib/wallet/WalletProvider";
import { OfferForm } from "./OfferForm";
import { ReportCard } from "./ReportCard";
import { AmountField, checkAmount, TextField, useMyBalance } from "./fields";

type Props = { business: Business; now: number; refresh: () => Promise<void>; featured?: boolean };

const ConnectGate = Gate;

export function ActionRail({ business: b, now, refresh }: Props) {
  const { account, ready } = useWallet();
  const s = standing({ ...b, now });
  const loan = b.current_loan;
  const isOperator = account === b.operator;
  const foreclosed = loan?.status === "Foreclosed";

  return (
    <aside className="space-y-4" aria-label="Actions">
      {!account && ready ? (
        <section className="panel p-5" aria-labelledby="take-part">
          <h2 id="take-part" className="text-[18px] font-medium tracking-[-0.01em]">Try it with play money</h2>
          <p className="mt-2 mb-4 text-[15px] leading-snug text-[var(--ink-2)]">Lend, buy a safety check or bid on a business. A free test account with $500 of <Term tip={GLOSSARY.testDollars}>test dollars</Term> is ready in about ten seconds, with nothing to install.</p>
          <ConnectButtons compact />
        </section>
      ) : null}
      {loan?.status === "Funding" ? <LendCard business={b} now={now} refresh={refresh} featured /> : null}
      {s === "behind" || s === "foreclosable" ? <ForecloseCard business={b} now={now} refresh={refresh} featured /> : null}
      {foreclosed ? <AuctionCard business={b} now={now} refresh={refresh} featured /> : null}
      <PositionCard business={b} refresh={refresh} />
      {isOperator ? <OperatorCard business={b} now={now} refresh={refresh} /> : null}
      <BuyCard business={b} refresh={refresh} featured={s === "current" || s === "no-loan"} />
      {loan && (loan.status === "Active" || foreclosed) ? <RepayCard business={b} refresh={refresh} isOperator={isOperator} /> : null}
      <TankCard business={b} refresh={refresh} />
    </aside>
  );
}

function LendCard({ business: b, now, refresh, featured }: Props) {
  const loan = b.current_loan!;
  const { busy, run } = useTx();
  const pay = usePay(b.id);
  const balance = useMyBalance();
  const [text, setText] = useState("");
  const principal = BigInt(loan.terms.principal);
  const remaining = principal - BigInt(loan.funded);
  const minNote = principal / 50n > 1n ? principal / 50n : 1n;
  const expired = now >= loan.funding_deadline;
  const min = remaining < minNote ? remaining : minNote;
  const check = checkAmount(text, { min, max: remaining, balance: balance.data });
  const value = check.value;
  const noteShare = value ? share(value, principal) : 0;
  const returns = value ? (BigInt(loan.terms.total_due) * value) / principal : 0n;
  const interest = Number(((BigInt(loan.terms.total_due) - principal) * 10_000n) / principal);

  if (expired) {
    return (
      <Panel title="Raising has ended">
        <p className="mb-4 text-[15px] leading-snug text-[var(--ink-2)]">This loan did not fill in time, so it will not go ahead. Cancelling it lets every lender take their money back.</p>
        <ConnectGate quiet reason="Connect to cancel it. Anyone can.">
          <button type="button" className="btn btn-primary w-full" disabled={busy} onClick={async () => { await run(tx.cancelOffer(b.id), { requiredOn: b.id, done: "The offer was cancelled" }); await refresh(); }}>Cancel the offer</button>
        </ConnectGate>
      </Panel>
    );
  }

  return (
    <Panel featured={featured} title="Lend to this business" aside={`Closes ${fromNow(loan.funding_deadline, now)}`}>
      <p className="mb-4 text-[15px] leading-snug text-[var(--ink-2)]">
        It pays lenders back from every sale, {percent(loan.terms.lender_bps)} of each one, until they have {percent(interest)} more than they lent. Your money only moves once the whole loan is raised.
      </p>
      <ConnectGate quiet reason="Connect to lend. You can read everything without one.">
        <form className="space-y-3" onSubmit={async (e) => {
          e.preventDefault();
          if (!value || check.error) return;
          const result = await pay(value, { action: "fund", loan_id: loan.id }, "Lend", "You lent to this business");
          if (result?.ok) setText("");
          await Promise.all([refresh(), balance.refresh()]);
        }}>
          <AmountField label="How much to lend" testId="lend-amount" value={text} onChange={setText} error={check.error} hint={`${money(remaining)} left to raise. The smallest loan is ${money(min)}.`} />
          <button type="button" className="link text-[14px]" onClick={() => setText(amount(balance.data !== undefined && balance.data < remaining ? balance.data : remaining, 6))}>Lend the most I can</button>
          {value && !check.error ? (
            <dl className="dl rounded-[12px] bg-[var(--surface-2)] p-4" data-testid="lend-preview">
              <dt><Term tip={GLOSSARY.share}>Your share</Term> of the full loan</dt><dd>{noteShare}%</dd>
              <dt>You get back in total</dt><dd>{money(returns)}</dd>
              <dt>If it stops paying</dt><dd>Lenders can take it over</dd>
            </dl>
          ) : null}
          <button type="submit" data-testid="lend-submit" className="btn btn-primary w-full" disabled={busy || !value || !!check.error}>{value && !check.error ? `Lend ${money(value)}` : "Enter an amount to lend"}</button>
        </form>
      </ConnectGate>
    </Panel>
  );
}

function ForecloseCard({ business: b, now, refresh, featured }: Props) {
  const loan = b.current_loan!;
  const { busy, run } = useTx();
  const ready = loan.foreclosable_at !== null && now >= loan.foreclosable_at;
  return (
    <Panel featured={featured} title={ready ? "Anyone can take over this business" : "This business is behind on payments"}>
      <p className="mb-4 text-[15px] leading-snug text-[var(--ink-2)]">
        {ready
          ? "It missed its payments and its extra time is up. Taking over does not shut it down: it keeps selling, its owner's share of each sale goes to lenders instead, and it goes up for auction. Anyone can do this, not only lenders."
          : `Any payment now puts it back on track. If none comes, anyone can take it over ${fromNow(loan.foreclosable_at!, now)}.`}
      </p>
      <ConnectGate quiet reason="Connect to take it over. Anyone can.">
        <button type="button" data-testid="foreclose" className="btn btn-warn w-full" disabled={busy || !ready} onClick={async () => { await run(tx.foreclose(b.id), { requiredOn: b.id, done: "You took over the business for its lenders" }); await refresh(); }}>
          {ready ? "Take over this business" : `Possible ${fromNow(loan.foreclosable_at!, now)}`}
        </button>
        <p className="hint"><Term tip={GLOSSARY.takeOver}>What happens next?</Term></p>
      </ConnectGate>
    </Panel>
  );
}

function AuctionCard({ business: b, now, refresh, featured }: Props) {
  const loan = b.current_loan!;
  const { account } = useWallet();
  const { busy, run } = useTx();
  const pay = usePay(b.id);
  const balance = useMyBalance();
  const [text, setText] = useState("");
  const ended = auctionEnded(loan, now);
  const high = BigInt(loan.auction.high_bid);
  const minNext = BigInt(loan.min_next_bid ?? "1");
  const check = checkAmount(text, { min: minNext, balance: balance.data });
  const outstanding = BigInt(loan.outstanding);
  const iWin = loan.auction.high_bidder === account && account !== null;
  const inside = BigInt(b.ledger.opex);

  return (
    <Panel featured={featured} title="Buy this business" aside={loan.auction.ends_at ? (ended ? "Auction over" : `Ends ${fromNow(loan.auction.ends_at, now)}`) : `${duration(loan.terms.auction_secs)} auction, starts with the first bid`}>
      <dl className="dl mb-3" data-testid="auction">
        <dt>Still owed to lenders</dt><dd>{money(outstanding)}</dd>
        <dt>Highest bid</dt><dd>{high > 0n ? money(high) : <span className="muted">No bids yet</span>}</dd>
        <dt>Money inside it</dt><dd>{money(inside)}</dd>
      </dl>
      {iWin && !ended ? (
        <p className="mb-3 rounded-[10px] bg-[var(--accent-tint)] px-4 py-3 text-[15px]" data-testid="winning">You are the highest bidder. If nobody bids more before the clock runs out, the business is yours.</p>
      ) : null}
      <p className="mb-4 text-[14px] leading-snug text-[var(--ink-2)]">
        The winner gets the whole business: its name, its customers, its future sales and the money inside it. The price pays lenders first; anything above the debt goes to the old owner. Bidding is open to anyone, so competition sets the price.
      </p>
      {ended ? (
        <ConnectGate quiet reason="Connect to complete the sale. Anyone can.">
          <button type="button" data-testid="settle" className="btn btn-primary w-full" disabled={busy} onClick={async () => { await run(tx.settleAuction(b.id), { requiredOn: b.id, done: "The sale is complete" }); await refresh(); }}>
            Complete the sale{iWin ? ", you won" : ""}
          </button>
        </ConnectGate>
      ) : (
        <ConnectGate quiet reason="Connect to bid.">
          <form className="space-y-3" onSubmit={async (e) => {
            e.preventDefault();
            if (!check.value || check.error) return;
            const result = await pay(check.value, { action: "bid" }, "Bid", "Your bid is in: you are the highest bidder");
            if (result?.ok) setText("");
            await Promise.all([refresh(), balance.refresh()]);
          }}>
            <AmountField label="Your bid" testId="bid-amount" value={text} onChange={setText} error={check.error} hint={`The lowest bid accepted now is ${money(minNext)}. If someone outbids you, your money comes straight back.`} />
            <button type="submit" data-testid="bid-submit" className="btn btn-primary w-full" disabled={busy || !check.value || !!check.error}>{check.value && !check.error ? `${iWin ? "Raise your bid to" : "Bid"} ${money(check.value)}` : iWin ? "Enter a higher bid" : "Enter a bid"}</button>
          </form>
        </ConnectGate>
      )}
    </Panel>
  );
}

const EXAMPLES = isTestnet ? ["outlayer.testnet", "wrap.testnet", "intents.testnet"] : ["usdc.near", "wrap.near", "intents.near"];

/** What went wrong with a refunded check, in words, from the reason the contract recorded. */
function refundText(reason: string | undefined, price: bigint): { text: string; retry: boolean } {
  const back = `Your ${money(price)} was refunded in full, automatically.`;
  switch (reason) {
    case "agent_declined":
      return { text: `No NEAR account name was found in what you typed, so the check did not run. ${back} Type an account name, like the examples above.`, retry: false };
    case "expired":
      return { text: `The check took too long and was cancelled. ${back}`, retry: true };
    case "execution_failed":
    case "no_output":
    case "malformed_output":
      return { text: `The secure computer that runs checks did not answer properly this time, which happens now and then on the test network. ${back}`, retry: true };
    default:
      return { text: `This check could not finish, so you were refunded in full (${money(price)}). Either the secure computer did not answer, or no account name was found in what you typed.`, retry: true };
  }
}

function BuyCard({ business: b, refresh, featured }: { business: Business; refresh: () => Promise<void>; featured?: boolean }) {
  const pay = usePay(b.id);
  const { busy } = useTx();
  const balance = useMyBalance();
  const [input, setInput] = useState("");
  const { account } = useWallet();
  const [job, setJob] = useState<{ id: number; result: Job | null; input: string; reason?: string; mine?: { payer: string; input: string; since: number } } | null>(null);
  const [slow, setSlow] = useState(false);
  const price = BigInt(b.service.price);
  const short = balance.data !== undefined && balance.data < price;
  const tankEmpty = BigInt(b.tank) < BigInt(b.service.compute_deposit);

  useEffect(() => {
    if (!job || job.result?.status === "Done" || job.result?.status === "Refunded") return;
    let alive = true;
    const timer = setInterval(async () => {
      const latest = await getJob(b.id, job.id).catch(() => null);
      if (!alive || !latest) return;
      // The page's copy of the business can be a few seconds old, so the number it expected may
      // belong to an earlier job: look at the next one until ours turns up.
      if (job.mine && (latest.payer !== job.mine.payer || latest.input !== job.mine.input || Number(latest.created_at) < job.mine.since)) {
        setJob({ ...job, id: job.id + 1, result: null });
        return;
      }
      if (latest.status === job.result?.status) return;
      setJob({ ...job, result: latest });
      if (latest.status !== "Pending") void refresh();
    }, 2_500);
    const slowTimer = setTimeout(() => { if (alive) setSlow(true); }, 45_000);
    return () => { alive = false; clearInterval(timer); clearTimeout(slowTimer); setSlow(false); };
  }, [job, b.id, refresh]);

  const submit = async (text: string) => {
    if (!text) return;
    // The transaction only settles once the secure computer answers, which can take minutes on
    // testnet. The job's number is known now, so its progress shows from the first second.
    setJob({ id: b.next_job_id, result: null, input: text, mine: { payer: account ?? "", input: text, since: Math.floor(Date.now() / 1000) - 30 } });
    const result = await pay(price, { action: "job", input: text }, "Buy a safety check", "Check delivered", "Paid. A secure computer is running the check now; this usually takes under a minute. You can keep using the page.");
    const started = result?.events.find((event) => event.event === "job_started");
    const refunded = result?.events.find((event) => event.event === "job_refunded");
    if (result?.ok && started) {
      const id = started.data.job_id as number;
      const reason = refunded?.data.job_id === id ? String(refunded.data.reason) : undefined;
      setJob((current) => current ? { ...current, id, mine: undefined, result: current.id === id ? current.result : null, reason: reason ?? current.reason } : current);
    } else if (!result?.ok) setJob(null);
    await Promise.all([refresh(), balance.refresh()]);
  };

  const refund = job?.result?.status === "Refunded" ? refundText(job.reason, price) : null;

  return (
    <Panel featured={featured} title={`Buy a safety check, ${money(price)}`}>
      <p className="mb-4 text-[15px] leading-snug text-[var(--ink-2)]">
        A safety report on any NEAR account, like a background check before you pay someone. It runs on a <Term tip={GLOSSARY.sealedComputer}>sealed computer</Term>, and if it fails you get your money back.
      </p>
      <ConnectGate quiet reason="Connect to buy one.">
        <form className="space-y-3" onSubmit={async (e) => { e.preventDefault(); await submit(input.trim()); }}>
          <TextField label="Account to check" testId="job-input" value={input} onChange={setInput} placeholder={`an account name, e.g. ${EXAMPLES[0]}`} />
          <div className="flex flex-wrap items-center gap-2" aria-label="Examples">
            <span className="text-[14px] muted">Try:</span>
            {EXAMPLES.map((example) => (
              <button key={example} type="button" className="example-chip" onClick={() => setInput(example)}>{example}</button>
            ))}
          </div>
          {short ? <p className="hint" data-error="true">You have {money(balance.data!)}, and a check costs {money(price)}. Use Get test funds to add more.</p> : null}
          {tankEmpty ? <p className="hint" data-error="true">This business has run out of fees for checks. Anyone can top it up at the bottom of this column.</p> : null}
          <button type="submit" data-testid="job-submit" className="btn btn-primary w-full" disabled={busy || !input.trim() || short || tankEmpty}>{input.trim() ? `Pay ${money(price)} and run the check` : "Type an account name first"}</button>
        </form>
      </ConnectGate>
      {job ? (
        <div className="inset appear mt-4" data-testid="job-result" aria-live="polite">
          {!job.result || job.result.status === "Pending" ? (
            <p className="flex items-start gap-2 text-[15px]"><span className="spinner spinner-ink mt-[3px] shrink-0" aria-hidden /> {slow ? "Still running. The test network's secure computers are slow right now, so this can take a few minutes. If it fails, your money comes back automatically." : "Running on the secure computer. This usually takes under a minute."}</p>
          ) : job.result.status === "Done" ? <ReportCard raw={job.result.report} /> : (
            <div className="space-y-3">
              <p className="text-[15px]">{refund!.text}</p>
              {refund!.retry ? <button type="button" className="btn btn-secondary btn-sm" disabled={busy || short} onClick={() => void submit(job.input)}>Try the same check again</button> : null}
            </div>
          )}
        </div>
      ) : null}
    </Panel>
  );
}

function RepayCard({ business: b, refresh, isOperator }: { business: Business; refresh: () => Promise<void>; isOperator: boolean }) {
  const loan = b.current_loan!;
  const { busy, run } = useTx();
  const pay = usePay(b.id);
  const balance = useMyBalance();
  const [text, setText] = useState("");
  const outstanding = BigInt(loan.outstanding);
  const check = checkAmount(text, { balance: balance.data });
  const foreclosed = loan.status === "Foreclosed";
  return (
    <Panel title={foreclosed ? "Pay off the debt to stop the sale" : "Pay down the debt"}>
      <p className="mb-4 text-[15px] leading-snug text-[var(--ink-2)]">
        {foreclosed
          ? `Paying the full ${money(outstanding)} before the auction ends cancels the sale and gives the business back to its owner. Anyone can pay.`
          : "Anyone can pay, not only the owner. It counts toward the next payment at once, and anything above the debt comes back to you."}
      </p>
      <ConnectGate quiet reason="Connect to pay.">
        <form className="space-y-3" onSubmit={async (e) => {
          e.preventDefault();
          if (!check.value || check.error) return;
          const result = await pay(check.value, { action: "repay" }, "Repay", "Payment received");
          if (result?.ok) setText("");
          await Promise.all([refresh(), balance.refresh()]);
        }}>
          <AmountField label="Amount" testId="repay-amount" value={text} onChange={setText} error={check.error} />
          <div className="flex items-center justify-between gap-2">
            <button type="button" className="link text-[14px]" onClick={() => setText(amount(outstanding, 6))}>Pay it all: {money(outstanding)}</button>
            <button type="submit" data-testid="repay-submit" className="btn btn-primary" disabled={busy || !check.value || !!check.error}>Pay</button>
          </div>
        </form>
        {isOperator && loan.status === "Active" && BigInt(b.ledger.opex) > 0n ? (
          <button type="button" className="btn btn-secondary mt-3 w-full" disabled={busy} data-testid="repay-opex" onClick={async () => {
            const available = BigInt(b.ledger.opex);
            const value = available < outstanding ? available : outstanding;
            await run(tx.repayFromOpex(b.id, value), { requiredOn: b.id, done: "Paid from the money kept for running costs" });
            await refresh();
          }}>
            Pay {money(BigInt(b.ledger.opex) < outstanding ? b.ledger.opex : outstanding)} from its running-cost money
          </button>
        ) : null}
      </ConnectGate>
    </Panel>
  );
}

type Position = { loan: LoanView; note: NoteView };

function PositionCard({ business: b, refresh }: { business: Business; refresh: () => Promise<void> }) {
  const { account } = useWallet();
  const { busy, run } = useTx();
  const [to, setTo] = useState("");
  const positions = useLive(
    account
      ? async (): Promise<Position[]> => {
          const loans = await getLoans(b.id);
          const notes = await Promise.all(loans.map(async (loan) => ({ loan, note: await getNote(b.id, loan.id, account) })));
          return notes.filter((p): p is Position => p.note !== null);
        }
      : null,
    `positions:${b.id}:${account}:${b.current_loan?.repaid}:${b.current_loan?.funded}:${b.loan_count}`,
    10_000,
  );
  const credit = useLive(account ? () => getCredit(b.id, account) : null, `credit:${b.id}:${account}`, 10_000);

  const owed = credit.data ?? 0n;
  const list = positions.data ?? [];
  const proposal = b.proposal;
  if (!account || (list.length === 0 && owed === 0n)) return null;

  return (
    <Panel title="Your money in this business" id="position">
      <div className="space-y-4" data-testid="position">
        {owed > 0n ? (
          <div>
            <p className="mb-2 text-[15px]">{money(owed)} is waiting for you here: a refund, a bid that was outbid, or a payout.</p>
            <button type="button" className="btn btn-primary w-full" disabled={busy} onClick={async () => { await run(tx.withdrawCredit(b.id, account), { done: "Paid out to you" }); await credit.refresh(); }}>Collect {money(owed)}</button>
          </div>
        ) : null}
        {list.map(({ loan, note }) => {
          const claimable = BigInt(note.claimable);
          const open = b.current_loan?.id === loan.id;
          return (
            <div key={loan.id} className="space-y-2">
              <dl className="dl">
                <dt>You lent{b.loan_count > 1 ? ` (loan ${loan.id + 1})` : ""}</dt><dd>{money(note.principal)}, {share(note.principal, loan.terms.principal)}% of the loan</dd>
                <dt>Collected so far</dt><dd>{money(note.claimed)}</dd>
                <dt>Ready to collect</dt><dd data-testid="claimable">{money(claimable)}</dd>
              </dl>
              <button type="button" data-testid="claim" className="btn btn-primary w-full" disabled={busy || claimable === 0n} onClick={async () => {
                await run(tx.claim(b.id, loan.id), { requiredOn: b.id, done: `Collected ${money(claimable)}` });
                await Promise.all([positions.refresh(), credit.refresh(), refresh()]);
              }}>{claimable === 0n ? "Nothing to collect yet: repayments arrive with each sale" : `Collect your repayments: ${money(claimable)}`}</button>
              {proposal && proposal.loan_id === loan.id && note.voted_proposal !== proposal.id ? (
                <div className="callout">
                  <p className="mb-2">The owner wants to change its program (new build <code>{proposal.service.wasm.hash.slice(0, 12)}…</code>, price {money(proposal.service.price)}). It needs lenders holding over half the loan to agree. Agreed so far: {share(proposal.approvals, loan.terms.principal)}%.</p>
                  <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={async () => { await run(tx.approveChange(b.id, proposal.id), { requiredOn: b.id, done: "Your approval is recorded" }); await Promise.all([positions.refresh(), refresh()]); }}>Approve the change</button>
                </div>
              ) : null}
              {open ? (
                <details className="text-[14px]">
                  <summary className="cursor-pointer py-2 text-[var(--ink-2)] hover:text-[var(--ink)]">Sell or give your share to someone else</summary>
                  <form className="mt-2 space-y-2" onSubmit={async (e) => {
                    e.preventDefault();
                    if (!to.trim()) return;
                    await run(tx.transferNote(b.id, loan.id, to.trim()), { requiredOn: b.id, done: "Your share of the loan moved" });
                    setTo("");
                    await positions.refresh();
                  }}>
                    <TextField label="Send it to account" value={to} onChange={setTo} hint="The whole share moves, with every future repayment. Agree a price with them first." />
                    <button className="btn btn-secondary btn-sm" disabled={busy || !to.trim()}>Send your whole share</button>
                  </form>
                </details>
              ) : null}
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

function OperatorCard({ business: b, now, refresh }: Props) {
  const { busy, run } = useTx();
  const loan = b.current_loan;
  const operatorShare = BigInt(b.ledger.operator);
  const opex = BigInt(b.ledger.opex);
  const [withdraw, setWithdraw] = useState("");
  const [price, setPrice] = useState("");
  const [newHash, setNewHash] = useState("");
  const [newUrl, setNewUrl] = useState("");
  const s = standing({ ...b, now });
  const locked = s === "behind" || s === "foreclosable" || s === "foreclosed" || s === "auction";
  const withdrawCheck = checkAmount(withdraw, { max: opex });
  const priceValue = parseAmount(price);
  const hashValid = /^[0-9a-f]{64}$/.test(newHash);
  const urlValid = newUrl.startsWith("https://");

  return (
    <Panel title="You own this business">
      <div className="space-y-4" data-testid="operator">
        <dl className="dl">
          <dt>Your share of sales</dt><dd>{money(operatorShare)}</dd>
          <dt><Term tip={GLOSSARY.runningCosts}>Kept for running costs</Term></dt><dd>{money(opex)}</dd>
          <dt>Spent today</dt><dd>{money(b.spent_today)} of {money(b.service.policy.max_per_day)}</dd>
          <dt>Spends its rules refused</dt><dd>{b.stats.spends_blocked}</dd>
        </dl>
        <button type="button" className="btn btn-primary w-full" data-testid="withdraw-share" disabled={busy || operatorShare === 0n || locked} onClick={async () => { await run(tx.withdrawOperator(b.id), { requiredOn: b.id, done: "Your share was paid out" }); await refresh(); }}>
          {locked ? "Your share is locked until it catches up" : operatorShare === 0n ? "Nothing to withdraw yet" : `Withdraw ${money(operatorShare)}`}
        </button>

        {loan?.status === "Funding" ? (
          <button type="button" className="btn btn-secondary w-full" disabled={busy} data-testid="cancel-offer" onClick={async () => { await run(tx.cancelOffer(b.id), { requiredOn: b.id, done: "The offer was cancelled, and lenders can take their money back" }); await refresh(); }}>Cancel this loan offer</button>
        ) : null}

        {!loan ? (
          <>
            <details open={b.loan_count === 0}>
              <summary className="cursor-pointer rounded-[10px] bg-[var(--surface-2)] px-4 py-3 text-[15px] font-medium transition-colors hover:bg-[var(--surface-3)]">Borrow against this business</summary>
              <div className="mt-3"><OfferForm business={b} refresh={refresh} /></div>
            </details>
            <details>
              <summary className="cursor-pointer rounded-[10px] bg-[var(--surface-2)] px-4 py-3 text-[15px] font-medium transition-colors hover:bg-[var(--surface-3)]">Withdraw running-cost money</summary>
              <form className="mt-3 space-y-2" onSubmit={async (e) => {
                e.preventDefault();
                if (!withdrawCheck.value || withdrawCheck.error) return;
                await run(tx.withdrawOpex(b.id, withdrawCheck.value), { requiredOn: b.id, done: "Paid out to you" });
                setWithdraw("");
                await refresh();
              }}>
                <AmountField label="Amount" value={withdraw} onChange={setWithdraw} error={withdrawCheck.error} hint={`${money(opex)} available. This is only possible while it has no loan.`} />
                <button className="btn btn-secondary btn-sm" disabled={busy || !withdrawCheck.value || !!withdrawCheck.error}>Withdraw</button>
              </form>
            </details>
            <details>
              <summary className="cursor-pointer rounded-[10px] bg-[var(--surface-2)] px-4 py-3 text-[15px] font-medium transition-colors hover:bg-[var(--surface-3)]">Change the price of a check</summary>
              <form className="mt-3 space-y-2" onSubmit={async (e) => {
                e.preventDefault();
                if (!priceValue) return;
                await run(tx.updateService(b.id, { ...b.service, price: priceValue.toString() }), { requiredOn: b.id, done: "Price updated" });
                setPrice("");
                await refresh();
              }}>
                <AmountField label="New price" value={price} onChange={setPrice} hint={`Now ${money(b.service.price)}.`} />
                <button className="btn btn-secondary btn-sm" disabled={busy || !priceValue}>Update</button>
              </form>
            </details>
          </>
        ) : null}

        {loan?.status === "Active" ? (
          <details>
            <summary className="cursor-pointer rounded-[10px] bg-[var(--surface-2)] px-4 py-3 text-[15px] font-medium transition-colors hover:bg-[var(--surface-3)]">Ask lenders to approve a new program</summary>
            {b.proposal ? (
              <p className="mt-3 text-[15px]">A change is waiting for lenders and has {share(b.proposal.approvals, loan.terms.principal)}% approval. It expires {fromNow(b.proposal.expires_at, now)}.</p>
            ) : (
              <form className="mt-3 space-y-2" onSubmit={async (e) => {
                e.preventDefault();
                if (!hashValid || !urlValid) return;
                await run(tx.proposeChange(b.id, { ...b.service, wasm: { ...b.service.wasm, url: newUrl, hash: newHash } }), { requiredOn: b.id, done: "Your proposal is open to lenders" });
                setNewHash("");
                setNewUrl("");
                await refresh();
              }}>
                <p className="hint">Its program is frozen during a loan. It only changes if lenders holding more than half the loan agree.</p>
                <TextField label="Build URL" value={newUrl} onChange={setNewUrl} error={newUrl && !urlValid ? "Must start with https://" : null} />
                <TextField label="SHA-256 of the build" value={newHash} onChange={setNewHash} error={newHash && !hashValid ? "64 lowercase hex characters" : null} />
                <button className="btn btn-secondary btn-sm" disabled={busy || !hashValid || !urlValid}>Propose</button>
              </form>
            )}
          </details>
        ) : null}
      </div>
    </Panel>
  );
}

function TankCard({ business: b, refresh }: { business: Business; refresh: () => Promise<void> }) {
  const { busy, run } = useTx();
  const { account } = useWallet();
  const tank = BigInt(b.tank);
  const perJob = BigInt(b.service.compute_deposit);
  const left = perJob > 0n ? tank / perJob : 0n;
  const low = tank < perJob * 5n;
  if (!low) {
    return <p className="px-2 text-[14px] muted" data-testid="tank">It has fees set aside for about {left.toString()} more checks.</p>;
  }
  return (
    <Panel title="Running low on fees for checks">
      <p className="mb-4 text-[15px] leading-snug text-[var(--ink-2)]">It can pay for about {left.toString()} more checks ({nearAmount(b.tank)} <Term tip={GLOSSARY.near}>NEAR</Term> left). Without fees it cannot sell, and it will fall behind on its loan. Anyone can add more, and lenders have the most reason to.</p>
      {account ? (
        <button type="button" className="btn btn-primary w-full" disabled={busy} onClick={async () => { await run(tx.fundTank(b.id, toYocto("1")), { requiredOn: b.id, done: "1 NEAR added for check fees" }); await refresh(); }}>Add 1 NEAR of fees</button>
      ) : null}
    </Panel>
  );
}
