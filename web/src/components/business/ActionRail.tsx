"use client";

import { useEffect, useState } from "react";
import { ConnectButtons, ConnectGate as Gate, useTx } from "@/components/Tx";
import { Panel } from "@/components/ui";
import { usePay } from "@/hooks/usePay";
import { useLive } from "@/hooks/useLive";
import { isTestnet } from "@/lib/config";
import { amount, fromNow, money, nearAmount, parseAmount, share, smartAmount, toYocto } from "@/lib/format";
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
          <h2 id="take-part" className="text-[18px] font-medium tracking-[-0.01em]">Take part in this loan</h2>
          <p className="mt-2 mb-4 text-[15px] leading-snug text-[var(--ink-2)]">Connect to lend, buy, bid or foreclose. A free test account is ready in about ten seconds. Everything else here is open to read.</p>
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

  if (expired) {
    return (
      <Panel title="Raising has ended">
        <p className="mb-4 text-[15px] leading-snug text-[var(--ink-2)]">This loan did not fill in time. Cancelling lets every lender claim their money back.</p>
        <ConnectGate quiet reason="Connect to cancel it. Anyone can.">
          <button type="button" className="btn btn-primary w-full" disabled={busy} onClick={async () => { await run(tx.cancelOffer(b.id), { requiredOn: b.id, done: "The offer was cancelled" }); await refresh(); }}>Cancel the offer</button>
        </ConnectGate>
      </Panel>
    );
  }

  return (
    <Panel featured={featured} title="Lend to this business" aside={`Closes ${fromNow(loan.funding_deadline, now)}`}>
      <ConnectGate quiet reason="Connect to lend. You can read everything without one.">
        <form className="space-y-3" onSubmit={async (e) => {
          e.preventDefault();
          if (!value || check.error) return;
          const result = await pay(value, { action: "fund", loan_id: loan.id }, "Lend", "You funded this loan");
          if (result?.ok) setText("");
          await Promise.all([refresh(), balance.refresh()]);
        }}>
          <AmountField label="Amount" testId="lend-amount" value={text} onChange={setText} error={check.error} hint={`${money(remaining)} left to raise, ${money(min)} minimum`} />
          <button type="button" className="link text-[14px]" onClick={() => setText(amount(balance.data !== undefined && balance.data < remaining ? balance.data : remaining, 6))}>Use the most I can</button>
          {value && !check.error ? (
            <dl className="dl" data-testid="lend-preview">
              <dt>Your share of the loan</dt><dd>{noteShare}%</dd>
              <dt>You are owed in total</dt><dd>{money(returns)}</dd>
              <dt>If it stops paying</dt><dd className="text-right">You vote and can take the business</dd>
            </dl>
          ) : null}
          <button type="submit" data-testid="lend-submit" className="btn btn-primary w-full" disabled={busy || !value || !!check.error}>Lend {value && !check.error ? money(value) : ""}</button>
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
    <Panel featured={featured} title={ready ? "This business can be foreclosed" : "This business is behind"}>
      <p className="mb-4 text-[15px] leading-snug text-[var(--ink-2)]">
        {ready
          ? "It missed its payments and its grace period is over. Anyone can take this step, and the business keeps running for lenders."
          : `A payment clears this at once. If none comes, anyone can foreclose ${fromNow(loan.foreclosable_at!, now)}.`}
      </p>
      <ConnectGate quiet reason="Connect to foreclose. Anyone can.">
        <button type="button" data-testid="foreclose" className="btn btn-danger w-full" disabled={busy || !ready} onClick={async () => { await run(tx.foreclose(b.id), { requiredOn: b.id, done: "The business is now in foreclosure" }); await refresh(); }}>
          {ready ? "Foreclose now" : `Foreclose ${fromNow(loan.foreclosable_at!, now)}`}
        </button>
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

  return (
    <Panel featured={featured} title="Buy this business" aside={loan.auction.ends_at ? (ended ? "Auction over" : `Ends ${fromNow(loan.auction.ends_at, now)}`) : "No bids yet"}>
      <dl className="dl mb-3" data-testid="auction">
        <dt>Debt outstanding</dt><dd>{money(outstanding)}</dd>
        <dt>Highest bid</dt><dd>{high > 0n ? money(high) : <span className="muted">none</span>}</dd>
        <dt>Working capital included</dt><dd>{money(b.ledger.opex)}</dd>
      </dl>
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
            const result = await pay(check.value, { action: "bid" }, "Bid", "Your bid is in");
            if (result?.ok) setText("");
            await Promise.all([refresh(), balance.refresh()]);
          }}>
            <AmountField label="Your bid" testId="bid-amount" value={text} onChange={setText} error={check.error} hint={`At least ${money(minNext)}. If you are outbid, it comes straight back.`} />
            <button type="submit" data-testid="bid-submit" className="btn btn-primary w-full" disabled={busy || !check.value || !!check.error}>{iWin ? "Raise your bid" : "Place bid"}</button>
          </form>
        </ConnectGate>
      )}
    </Panel>
  );
}

function BuyCard({ business: b, refresh, featured }: { business: Business; refresh: () => Promise<void>; featured?: boolean }) {
  const pay = usePay(b.id);
  const { busy } = useTx();
  const balance = useMyBalance();
  const [input, setInput] = useState("");
  const { account } = useWallet();
  const [job, setJob] = useState<{ id: number; result: Job | null; mine?: { payer: string; input: string } } | null>(null);
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
      // Someone else bought the job with this number first: wait for our transaction to name ours.
      if (job.mine && (latest.payer !== job.mine.payer || latest.input !== job.mine.input)) return;
      if (latest.status === job.result?.status) return;
      setJob({ id: job.id, result: latest, mine: job.mine });
      if (latest.status !== "Pending") void refresh();
    }, 2_500);
    const slowTimer = setTimeout(() => { if (alive) setSlow(true); }, 20_000);
    return () => { alive = false; clearInterval(timer); clearTimeout(slowTimer); setSlow(false); };
  }, [job, b.id, refresh]);

  return (
    <Panel featured={featured} title={`Buy a check, ${money(price)}`}>
      <p className="mb-4 text-[15px] leading-snug text-[var(--ink-2)]">
        Sealed code reads a NEAR account from the chain and scores what could go wrong if you trust it. If the run fails, your money comes back.
      </p>
      <ConnectGate quiet reason="Connect to buy one.">
        <form className="space-y-3" onSubmit={async (e) => {
          e.preventDefault();
          if (!input.trim()) return;
          // The transaction only settles once the enclave answers, which can take minutes on
          // testnet. The job's number is known now, so its progress shows from the first second.
          setJob({ id: b.next_job_id, result: null, mine: { payer: account ?? "", input: input.trim() } });
          const result = await pay(price, { action: "job", input: input.trim() }, "Buy a check", "Check delivered", "Paid. The check runs in a secure enclave, which can take a minute or two on testnet. You can keep using the page.");
          const started = result?.events.find((event) => event.event === "job_started");
          if (result?.ok && started) setJob((current) => current?.id === started.data.job_id ? current : { id: started.data.job_id as number, result: null });
          else if (!result?.ok) setJob(null);
          await Promise.all([refresh(), balance.refresh()]);
        }}>
          <TextField label="Account to check" testId="job-input" value={input} onChange={setInput} placeholder={isTestnet ? "outlayer.testnet" : "usdc.near"} />
          {short ? <p className="hint" data-error="true">You hold {money(balance.data!)}, and a check costs {money(price)}.</p> : null}
          {tankEmpty ? <p className="hint" data-error="true">This business is out of compute funds. Top it up below first.</p> : null}
          <button type="submit" data-testid="job-submit" className="btn btn-primary w-full" disabled={busy || !input.trim() || short || tankEmpty}>Pay and run</button>
        </form>
      </ConnectGate>
      {job ? (
        <div className="inset appear mt-4" data-testid="job-result" aria-live="polite">
          {!job.result || job.result.status === "Pending" ? (
            <p className="flex items-center gap-2 text-[15px]"><span className="spinner spinner-ink" aria-hidden /> {slow ? "Still running. The enclave on testnet is busy and can take a few minutes; if the run fails, you get your money back." : "Running in the secure enclave. This usually takes 15 to 60 seconds."}</p>
          ) : job.result.status === "Done" ? <ReportCard raw={job.result.report} /> : (
            <p className="text-[15px]">This check could not be completed, so you were refunded in full. Usually the input had no NEAR account in it.</p>
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
    <Panel title={foreclosed ? "Redeem this business" : "Pay down the debt"}>
      <p className="mb-4 text-[15px] leading-snug text-[var(--ink-2)]">
        {foreclosed ? `Paying the full ${money(outstanding)} cancels the sale and returns the business to its operator. Anyone can pay.` : "Anyone can pay. Payments count towards the schedule right away, and anything above the debt comes back."}
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
            await run(tx.repayFromOpex(b.id, value), { requiredOn: b.id, done: "Paid from working capital" });
            await refresh();
          }}>
            Pay from working capital ({smartAmount(BigInt(b.ledger.opex) < outstanding ? b.ledger.opex : outstanding)})
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
    <Panel title="Your position" id="position">
      <div className="space-y-4" data-testid="position">
        {owed > 0n ? (
          <div>
            <p className="mb-2 text-[15px]">{money(owed)} is waiting for you here.</p>
            <button type="button" className="btn btn-primary w-full" disabled={busy} onClick={async () => { await run(tx.withdrawCredit(b.id, account), { done: "Paid out" }); await credit.refresh(); }}>Collect</button>
          </div>
        ) : null}
        {list.map(({ loan, note }) => {
          const claimable = BigInt(note.claimable);
          const open = b.current_loan?.id === loan.id;
          return (
            <div key={loan.id} className="space-y-2">
              <dl className="dl">
                <dt>Loan {loan.id + 1} note</dt><dd>{money(note.principal)}, {share(note.principal, loan.funded)}%</dd>
                <dt>Collected</dt><dd>{money(note.claimed)}</dd>
                <dt>Ready to collect</dt><dd data-testid="claimable">{money(claimable)}</dd>
              </dl>
              <button type="button" data-testid="claim" className="btn btn-primary w-full" disabled={busy || claimable === 0n} onClick={async () => {
                await run(tx.claim(b.id, loan.id), { requiredOn: b.id, done: `Collected ${money(claimable)}` });
                await Promise.all([positions.refresh(), credit.refresh(), refresh()]);
              }}>{claimable === 0n ? "Nothing to collect yet" : `Collect ${money(claimable)}`}</button>
              {proposal && proposal.loan_id === loan.id && note.voted_proposal !== proposal.id ? (
                <div className="callout">
                  <p className="mb-2">A change is proposed: new build <code>{proposal.service.wasm.hash.slice(0, 12)}…</code>, price {money(proposal.service.price)}. Approved so far: {share(proposal.approvals, loan.funded)}%.</p>
                  <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={async () => { await run(tx.approveChange(b.id, proposal.id), { requiredOn: b.id, done: "Your approval is recorded" }); await Promise.all([positions.refresh(), refresh()]); }}>Approve it</button>
                </div>
              ) : null}
              {open ? (
                <details className="text-[14px]">
                  <summary className="cursor-pointer py-2 text-[var(--ink-2)] hover:text-[var(--ink)]">Sell or move this note</summary>
                  <form className="mt-2 space-y-2" onSubmit={async (e) => {
                    e.preventDefault();
                    if (!to.trim()) return;
                    await run(tx.transferNote(b.id, loan.id, to.trim()), { requiredOn: b.id, done: "Your note moved" });
                    setTo("");
                    await positions.refresh();
                  }}>
                    <TextField label="Send it to account" value={to} onChange={setTo} />
                    <button className="btn btn-secondary btn-sm" disabled={busy || !to.trim()}>Transfer the whole note</button>
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
    <Panel title="You operate this business">
      <div className="space-y-4" data-testid="operator">
        <dl className="dl">
          <dt>Your share</dt><dd>{money(operatorShare)}</dd>
          <dt>Working capital</dt><dd>{money(opex)}</dd>
          <dt>Spent today</dt><dd>{money(b.spent_today)} of {money(b.service.policy.max_per_day)}</dd>
          <dt>Blocked spends</dt><dd>{b.stats.spends_blocked}</dd>
        </dl>
        <button type="button" className="btn btn-primary w-full" data-testid="withdraw-share" disabled={busy || operatorShare === 0n || locked} onClick={async () => { await run(tx.withdrawOperator(b.id), { requiredOn: b.id, done: "Your share was paid out" }); await refresh(); }}>
          {locked ? "Your share is locked until you catch up" : operatorShare === 0n ? "Nothing to withdraw yet" : `Withdraw ${money(operatorShare)}`}
        </button>

        {loan?.status === "Funding" ? (
          <button type="button" className="btn btn-secondary w-full" disabled={busy} data-testid="cancel-offer" onClick={async () => { await run(tx.cancelOffer(b.id), { requiredOn: b.id, done: "The offer was cancelled, and lenders can claim their money" }); await refresh(); }}>Cancel this offer</button>
        ) : null}

        {!loan ? (
          <>
            <details open={b.loan_count === 0}>
              <summary className="cursor-pointer rounded-[10px] bg-[var(--surface-2)] px-4 py-3 text-[15px] font-medium transition-colors hover:bg-[var(--surface-3)]">Borrow against this business</summary>
              <div className="mt-3"><OfferForm business={b} refresh={refresh} /></div>
            </details>
            <details>
              <summary className="cursor-pointer rounded-[10px] bg-[var(--surface-2)] px-4 py-3 text-[15px] font-medium transition-colors hover:bg-[var(--surface-3)]">Withdraw working capital</summary>
              <form className="mt-3 space-y-2" onSubmit={async (e) => {
                e.preventDefault();
                if (!withdrawCheck.value || withdrawCheck.error) return;
                await run(tx.withdrawOpex(b.id, withdrawCheck.value), { requiredOn: b.id, done: "Paid out" });
                setWithdraw("");
                await refresh();
              }}>
                <AmountField label="Amount" value={withdraw} onChange={setWithdraw} error={withdrawCheck.error} hint={`${money(opex)} available. This is only possible with no open loan.`} />
                <button className="btn btn-secondary btn-sm" disabled={busy || !withdrawCheck.value || !!withdrawCheck.error}>Withdraw</button>
              </form>
            </details>
            <details>
              <summary className="cursor-pointer rounded-[10px] bg-[var(--surface-2)] px-4 py-3 text-[15px] font-medium transition-colors hover:bg-[var(--surface-3)]">Change the price</summary>
              <form className="mt-3 space-y-2" onSubmit={async (e) => {
                e.preventDefault();
                if (!priceValue) return;
                await run(tx.updateService(b.id, { ...b.service, price: priceValue.toString() }), { requiredOn: b.id, done: "Price updated" });
                setPrice("");
                await refresh();
              }}>
                <AmountField label="New price per job" value={price} onChange={setPrice} hint={`Now ${money(b.service.price)}.`} />
                <button className="btn btn-secondary btn-sm" disabled={busy || !priceValue}>Update</button>
              </form>
            </details>
          </>
        ) : null}

        {loan?.status === "Active" ? (
          <details>
            <summary className="cursor-pointer rounded-[10px] bg-[var(--surface-2)] px-4 py-3 text-[15px] font-medium transition-colors hover:bg-[var(--surface-3)]">Propose a new build to lenders</summary>
            {b.proposal ? (
              <p className="mt-3 text-[15px]">A change is open and has {share(b.proposal.approvals, loan.funded)}% approval. It expires {fromNow(b.proposal.expires_at, now)}.</p>
            ) : (
              <form className="mt-3 space-y-2" onSubmit={async (e) => {
                e.preventDefault();
                if (!hashValid || !urlValid) return;
                await run(tx.proposeChange(b.id, { ...b.service, wasm: { ...b.service.wasm, url: newUrl, hash: newHash } }), { requiredOn: b.id, done: "Your proposal is open to lenders" });
                setNewHash("");
                setNewUrl("");
                await refresh();
              }}>
                <p className="hint">The code is frozen during a loan. It only changes if holders of more than half the principal agree.</p>
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
  const low = tank < perJob * 5n;
  if (!low) {
    return <p className="px-2 text-[14px] muted" data-testid="tank">Compute funds: {nearAmount(b.tank)} NEAR, enough for about {(tank / perJob).toString()} jobs.</p>;
  }
  return (
    <Panel title="Low on compute funds">
      <p className="mb-4 text-[15px] leading-snug text-[var(--ink-2)]">It has {nearAmount(b.tank)} NEAR left. Without compute it cannot sell, and it will fall behind. Anyone can top it up, and lenders have the most reason to.</p>
      {account ? (
        <button type="button" className="btn btn-primary w-full" disabled={busy} onClick={async () => { await run(tx.fundTank(b.id, toYocto("1")), { requiredOn: b.id, done: "1 NEAR added" }); await refresh(); }}>Add 1 NEAR</button>
      ) : null}
    </Panel>
  );
}

