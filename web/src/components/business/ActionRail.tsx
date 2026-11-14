"use client";

import { useEffect, useRef, useState } from "react";
import { ConnectButtons, ConnectGate as Gate, useTx } from "@/components/Tx";
import { Info, Panel, Term } from "@/components/ui";
import { usePay } from "@/hooks/usePay";
import { useLive } from "@/hooks/useLive";
import { isTestnet } from "@/lib/config";
import { CENT, centsUp, dateTime, duration, fromNow, inputAmount, money, moneyUp, nearAmount, owedMoney, pct, pctExact, percent, share, toYocto } from "@/lib/format";
import { hasAccountName, isAccountId, targetProblem } from "@/lib/accounts";
import { REFRESH_EVENT } from "@/lib/events";
import { GLOSSARY } from "@/lib/glossary";
import * as tx from "@/lib/near/actions";
import { accountExists, getCredit, getJob, getLoans, getNote } from "@/lib/near/rpc";
import type { Business, LoanView, NoteView } from "@/lib/near/types";
import { auctionEnded, isTrapped, standing } from "@/lib/status";
import { useWallet } from "@/lib/wallet/WalletProvider";
import { OfferForm } from "./OfferForm";
import { ReportCard, VerdictBadge } from "./ReportCard";
import { FreeCheck } from "./FreeCheck";
import { isFinal, loadChecks, saveChecks, type SavedCheck } from "@/lib/checks";
import { settleNotice } from "@/lib/events";
import { parseReport } from "@/lib/report";
import { ShareTransfer } from "./ShareTransfer";
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
    <aside className="space-y-4" aria-label="Actions" data-action-rail>
      {!account && ready ? (
        <section className="panel p-5" aria-labelledby="take-part">
          <h2 id="take-part" className="text-[18px] font-medium tracking-[-0.01em]">Try it with test dollars</h2>
          <p className="mt-2 mb-4 text-[15px] leading-snug text-[var(--ink-2)]">A free account with $500 of <Term tip={GLOSSARY.testDollars}>test dollars</Term>, ready in ten seconds.<Info label="test account" tip="Use it to lend, buy a safety check or bid on a business. It is ready in about ten seconds, with nothing to install." /></p>
          <ConnectButtons compact />
        </section>
      ) : null}
      {loan?.status === "Funding" ? <LendCard business={b} now={now} refresh={refresh} featured /> : null}
      {s === "behind" || s === "foreclosable" ? <ForecloseCard business={b} now={now} refresh={refresh} featured /> : null}
      {foreclosed ? <AuctionCard business={b} now={now} refresh={refresh} featured /> : null}
      <PositionCard business={b} refresh={refresh} />
      {isOperator ? <OperatorCard business={b} now={now} refresh={refresh} /> : null}
      <BuyCard business={b} refresh={refresh} featured={s === "current" || s === "no-loan"} />
      {loan && (loan.status === "Active" || (foreclosed && s !== "sale-ended")) ? <RepayCard business={b} refresh={refresh} isOperator={isOperator} /> : null}
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
  const floor = (BigInt(loan.terms.total_due) * BigInt(loan.terms.auction_reserve_bps)) / 10_000n;

  if (expired) {
    return (
      <Panel title="Raising has ended">
        <p className="mb-4 text-[15px] leading-snug text-[var(--ink-2)]">Not filled in time. Cancelling lets every lender take their money back.</p>
        <ConnectGate quiet reason="Connect to cancel it. Anyone can.">
          <button type="button" className="btn btn-primary w-full" disabled={busy} onClick={async () => { await run(tx.cancelOffer(b.id), { requiredOn: b.id, done: "The offer was cancelled" }); await refresh(); }}>Cancel the offer</button>
        </ConnectGate>
      </Panel>
    );
  }

  return (
    <Panel featured={featured} title="Lend to this business" aside={`Closes ${fromNow(loan.funding_deadline, now)}`}>
      <p className="mb-4 text-[15px] leading-snug text-[var(--ink-2)]">
        Lenders get {percent(loan.terms.lender_bps)} of every sale until repaid plus {percent(interest)}.
      </p>
      <ConnectGate quiet reason="Connect to lend.">
        <form className="space-y-3" onSubmit={async (e) => {
          e.preventDefault();
          if (!value || check.error) return;
          const result = await pay(value, { action: "fund", loan_id: loan.id }, "Lend", "You lent to this business");
          if (result?.ok) setText("");
          await Promise.all([refresh(), balance.refresh()]);
        }}>
          <AmountField label="How much to lend" testId="lend-amount" value={text} onChange={setText} error={check.error} hint={`${money(remaining)} left to raise · minimum ${money(min)}`} />
          <button type="button" className="link text-[14px]" onClick={() => { const most = balance.data !== undefined && balance.data < remaining ? balance.data : remaining; setText(inputAmount(most - (most % CENT))); }}>Lend the most I can</button>
          <button type="submit" data-testid="lend-submit" className="btn btn-primary w-full" disabled={busy || !value || !!check.error}>{value && !check.error ? `Lend ${money(value)}` : "Enter an amount to lend"}</button>
          {value && !check.error ? (
            <dl className="dl rounded-[12px] bg-[var(--surface-2)] p-4" data-testid="lend-preview">
              <dt><Term tip={GLOSSARY.share}>Your share</Term></dt><dd>{pctExact(noteShare)} of the loan</dd>
              <dt>You get back</dt><dd>{money(returns)} in total</dd>
              <dt>If it stops paying</dt><dd>Anyone can take it over</dd>
              <dt>If taken over and sold<Info label="sale floor" tip={`After a takeover the business is auctioned. The first bid must be at least ${percent(loan.terms.auction_reserve_bps)} of what is still owed (a floor the owner set in the terms), and each later bid must beat the highest by 5%. The price pays lenders first, split by their shares. Counting repayments before the takeover, lenders as a whole get back at least ${moneyUp(floor)}. Your figure assumes it sells at or above that reserve price.`} /></dt>
              <dd data-testid="lend-floor">At least {moneyUp((floor * value) / principal)} in total</dd>
            </dl>
          ) : null}
          <p className="hint">Held by the contract until fully raised; refundable if not by {dateTime(loan.funding_deadline)}.<Info label="where your money waits" tip="Your money leaves your balance at once and is held by the contract. It reaches the business only when the whole loan is raised; if it isn't by the deadline, you can take it back." /></p>
        </form>
      </ConnectGate>
    </Panel>
  );
}

function ForecloseCard({ business: b, now, refresh, featured }: Props) {
  const loan = b.current_loan!;
  const { busy, run } = useTx();
  const ready = loan.foreclosable_at !== null && now >= loan.foreclosable_at;
  const [confirming, setConfirming] = useState(false);
  return (
    <Panel featured={featured} title={ready ? "Anyone can take over this business" : "This business is behind on payments"}>
      <p className="mb-4 text-[15px] leading-snug text-[var(--ink-2)]">
        {ready ? "It keeps selling; the owner's share goes to lenders. Anyone can do this." : "Any payment now puts it back on track."}
        <Info label="taking over" tip={ready
          ? "It missed its payments and its extra time is up. Taking over does not shut it down: it keeps selling, its owner's share of each sale goes to lenders instead, and it goes up for auction. Anyone can do this, not only lenders."
          : `If no payment comes, anyone can take it over ${fromNow(loan.foreclosable_at!, now)}.`} />
      </p>
      <ConnectGate quiet reason="Connect to take it over. Anyone can.">
        {confirming && ready ? (
          <div className="space-y-3 rounded-[12px] bg-[var(--surface-2)] p-4 text-[15px] leading-snug" data-testid="foreclose-confirm-box">
            <p className="font-medium">What taking over does</p>
            <ul className="list-disc space-y-1 pl-5 text-[var(--ink-2)]">
              <li>Owner&rsquo;s unpaid share and spare running money go to lenders now.</li>
              <li>The owner&rsquo;s share of every later sale goes to lenders.</li>
              <li>It goes up for auction; the price pays lenders first.</li>
            </ul>
            <p className="text-[var(--ink-2)]">You pay only the network fee.<Info label="what you get" tip="If you lent to it, your share of that money is yours to collect; either way, you can then bid to buy it." /></p>
            <div className="flex flex-wrap gap-2">
              <button type="button" data-testid="foreclose-confirm" className="btn btn-warn" disabled={busy} onClick={async () => {
                const result = await run(tx.foreclose(b.id), { requiredOn: b.id, done: "Taken over: lenders get the owner's share; auction open" });
                if (result?.ok) setConfirming(false);
                await refresh();
              }}>Yes, take it over</button>
              <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => setConfirming(false)}>Not now</button>
            </div>
          </div>
        ) : (
          <button type="button" data-testid="foreclose" className="btn btn-warn w-full" disabled={busy || !ready} onClick={() => setConfirming(true)}>
            {ready ? "Take over this business" : `Possible ${fromNow(loan.foreclosable_at!, now)}`}
          </button>
        )}
        <p className="hint">Then it is auctioned from the first bid; the price pays lenders first.</p>
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
  // When the high bid moves (your own bid landing, or someone else's), a typed amount that no
  // longer clears the new minimum is cleared, not shown as an error: the hint gives the new one.
  const [seenHigh, setSeenHigh] = useState(loan.auction.high_bid);
  if (seenHigh !== loan.auction.high_bid) {
    setSeenHigh(loan.auction.high_bid);
    const typed = checkAmount(text, {}).value;
    if (typed !== null && typed < minNext) setText("");
  }
  const check = checkAmount(text, { min: minNext, balance: balance.data });
  const iWin = loan.auction.high_bidder === account && account !== null;
  const inside = BigInt(b.ledger.opex);

  return (
    <Panel featured={featured} title={ended ? "Auction ended: anyone can complete the sale" : "Buy this business"} aside={loan.auction.ends_at ? (ended ? undefined : `Ends ${fromNow(loan.auction.ends_at, now)}`) : `${duration(loan.terms.auction_secs)} auction, starts with the first bid`}>
      <dl className="dl mb-3" data-testid="auction">
        <dt>Still owed to lenders<Info label="still owed" tip="What lenders are still owed. The sale price pays this first; anything above it goes to the old owner." /></dt><dd>{owedMoney(loan.terms.total_due, loan.repaid)}</dd>
        <dt>Highest bid</dt><dd>{high > 0n ? money(high) : <span className="muted">No bids yet</span>}</dd>
        {!ended ? <><dt>Lowest bid accepted<Info label="lowest bid" tip="The first bid must be at least the floor in the loan's terms, a share of what is still owed. After that, each bid must beat the highest by at least 5%." /></dt><dd>{moneyUp(minNext)}</dd></> : null}
        <dt>Running money inside<Info label="running money" tip="Money the business keeps to pay for its work. The buyer gets it with the business." /></dt><dd>{money(inside)}</dd>
      </dl>
      {!ended && minNext < inside ? (
        <p className="mb-3 rounded-[10px] bg-[var(--surface-2)] px-4 py-3 text-[14px] leading-snug" data-testid="bargain">
          Lowest bid {moneyUp(minNext)}, below the {money(inside)} running money inside.<Info label="low floor" tip="The buyer gets that running money. This floor was set in the loan's terms, and lenders accepted it when they lent. Bids above it go to lenders." />
        </p>
      ) : null}
      {iWin && !ended ? (
        <p className="mb-3 rounded-[10px] bg-[var(--accent-tint)] px-4 py-3 text-[15px]" data-testid="winning">You are the highest bidder. If nobody outbids you, it&rsquo;s yours.</p>
      ) : null}
      <p className="mb-4 text-[14px] leading-snug text-[var(--ink-2)]">
        Winner gets the whole business. The price pays lenders first.
        <Info label="what the winner gets" tip="Its name, its customers, its future sales and the money inside it. Anything above the debt goes to the old owner. Bidding is open to anyone, so competition sets the price." />
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
            // Cleared once the bid is in; the hint then shows the next minimum, not an error.
            if (result?.ok) setText("");
            await Promise.all([refresh(), balance.refresh()]);
            // Nodes lag by a block: read the balance again so it shows the bid taken out.
            setTimeout(() => void balance.refresh(), 2_500);
          }}>
            <AmountField label="Your bid" testId="bid-amount" value={text} onChange={setText} error={check.error} hint={`Minimum ${moneyUp(minNext)} · outbid bids are refunded.`} />
            <button type="submit" data-testid="bid-submit" className="btn btn-primary w-full" disabled={busy || !check.value || !!check.error}>{check.value && !check.error ? `${iWin ? "Raise your bid to" : "Bid"} ${money(check.value)}` : iWin ? "Enter a higher bid" : "Enter a bid"}</button>
          </form>
        </ConnectGate>
      )}
    </Panel>
  );
}

/**
 * Examples that show the range of answers, each labelled with what to expect. The outcomes are
 * what Sentinel's rules (lib/risk.ts) gave these accounts when chosen; a live check reads the
 * account as it is now, so the label says "likely". A name nobody owns is answered for free,
 * before any money moves.
 */
export const EXAMPLES: Array<{ label: string; account: string }> = isTestnet
  ? [
      { label: "A safe one", account: "aurora.testnet" },
      { label: "A risky one", account: "outlayer.testnet" },
      { label: "No such account", account: "nobody-here.testnet" },
      // On the shared blocklist (contracts/reports): the free check below blocks it with the evidence.
      { label: "Reported", account: "attacker.testnet" },
    ]
  : [
      // Not yet scored on mainnet, so these carry no promise about the outcome.
      { label: "Try", account: "usdc.near" },
      { label: "Try", account: "intents.near" },
      { label: "No such account", account: "nobody-here.near" },
    ];

/**
 * A name nobody owns, found before anything is paid. Sentinel's rules score a missing account 90
 * of 100 (lib/risk.ts), which is BLOCK, so that is the answer shown, free.
 */
function NoSuchAccount({ name }: { name: string }) {
  return (
    <div className="inset space-y-2" data-testid="no-such-account" role="status">
      <p className="flex flex-wrap items-center gap-2"><VerdictBadge verdict="BLOCK" /><span className="text-[14px] muted">Answered for free, nothing was charged</span></p>
      <p className="text-[17px] font-medium">No such account</p>
      <p className="text-[15px] leading-snug text-[var(--ink-2)]">Nothing exists at <span className="font-medium text-[var(--ink)] [overflow-wrap:anywhere]">{name}</span>. Check the spelling.<Info label="no such account" tip={`Nothing exists at that name on the ${isTestnet ? "test " : ""}network, so anything sent to it could be lost. Sentinel's rules block it; there is nothing to pay for.`} /></p>
    </div>
  );
}

/** What went wrong with a refunded check, in words, from the reason the contract recorded. */
function refundText(reason: string | undefined, price: bigint): { text: string; retry: boolean } {
  const back = `Your ${money(price)} was refunded in full.`;
  switch (reason) {
    case "agent_declined":
      return { text: `No account name found, so it did not run. ${back} Type an account name.`, retry: false };
    case "expired":
      return { text: `The check timed out. ${back}`, retry: true };
    case "execution_failed":
    case "no_output":
    case "malformed_output":
      return { text: `The test network's secure computer failed this time. ${back}`, retry: true };
    default:
      return { text: `Could not finish (no answer, or no account name). Refunded in full: ${money(price)}.`, retry: true };
  }
}

function BuyCard({ business: b, refresh, featured }: { business: Business; refresh: () => Promise<void>; featured?: boolean }) {
  const pay = usePay(b.id);
  const { busy } = useTx();
  const balance = useMyBalance();
  const [input, setInput] = useState("");
  const { account } = useWallet();
  const [checks, setChecks] = useState<{ for: string; list: SavedCheck[] }>({ for: "", list: [] });
  const [clock, setClock] = useState(0);
  const price = BigInt(b.service.price);
  const short = balance.data !== undefined && balance.data < price;
  const tankEmpty = BigInt(b.tank) < BigInt(b.service.compute_deposit);
  // Checked before any money moves: a check needs an account to look at.
  const [missing, setMissing] = useState<string | null>(null);
  const shapeError = input.trim() ? targetProblem(input, isTestnet) : null;
  const named = !shapeError && hasAccountName(input);
  // A name nobody owns is answered at once, for free, and shown as the verdict a paid check would give.
  const missingNow = missing && missing === input.trim() ? missing : null;
  const inputError = shapeError;
  const inputRef = useRef<HTMLDivElement>(null);
  const owner = `${b.id}:${account ?? ""}`;
  const list = checks.for === owner ? checks.list : [];

  // Every change is written to this browser at once, so nothing bought is ever lost.
  const update = (change: (list: SavedCheck[]) => SavedCheck[]) =>
    setChecks((current) => ({ for: owner, list: saveChecks(b.id, account, change(current.for === owner ? current.list : loadChecks(b.id, account))) }));

  // On arrival (and after a refresh or Back), pick up the checks bought here before.
  useEffect(() => {
    const saved = loadChecks(b.id, account);
    setChecks({ for: `${b.id}:${account ?? ""}`, list: saved });
  }, [b.id, account]);

  // "Bought 40s ago" keeps counting while a check runs.
  const running = list.some((c) => !isFinal(c));
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setClock(Math.floor(Date.now() / 1000)), 1_000);
    return () => clearInterval(timer);
  }, [running]);

  // Follow every unfinished check to its result.
  useEffect(() => {
    if (!running) return;
    let alive = true;
    const timer = setInterval(async () => {
      for (const check of list.filter((c) => !isFinal(c))) {
        const latest = await getJob(b.id, check.id).catch(() => null);
        if (!alive || !latest) continue;
        // The page's copy of the business can be a few seconds old, so a number it expected may
        // belong to an earlier job: look at the next one until ours turns up.
        if (!check.confirmed && (latest.payer !== account || latest.input !== check.input || Number(latest.created_at) < check.since - 30)) {
          update((all) => all.map((c) => (c === check || (c.id === check.id && c.since === check.since) ? { ...c, id: c.id + 1 } : c)));
          continue;
        }
        if (latest.status === check.status) continue;
        update((all) => all.map((c) => (c.id === check.id && c.since === check.since ? { ...c, confirmed: true, status: latest.status, report: latest.report } : c)));
        if (latest.status !== "Pending") {
          // The result is in: say so now, even if the payment is still finalising on the network.
          settleNotice(latest.status === "Done"
            ? { summary: "Buy a safety check", tone: "done", title: "Check delivered", text: "Report ready on this page. Lenders got their share." }
            : { summary: "Buy a safety check", tone: "done", title: "Check refunded", text: `It couldn't finish. Your ${money(price)} came back.` });
          // The lenders' share lands with the result: re-read the loan now and once more for a lagging node.
          void refresh();
          window.dispatchEvent(new Event(REFRESH_EVENT));
          setTimeout(() => { void refresh(); window.dispatchEvent(new Event(REFRESH_EVENT)); }, 2_500);
        }
      }
    }, 2_500);
    return () => { alive = false; clearInterval(timer); };
    // `update` is rebuilt every render; the list it reads is the dependency that matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, list, b.id, account, refresh]);

  const submit = async (text: string) => {
    if (!text || !hasAccountName(text) || targetProblem(text, isTestnet)) return;
    // A single account name is looked up first: a name nobody owns costs nothing to find out.
    if (isAccountId(text)) {
      const exists = await accountExists(text).catch(() => true);
      if (!exists) { setMissing(text); return; }
    }
    const since = Math.floor(Date.now() / 1000);
    // Saved before paying: if the page is refreshed mid-payment, the check is still followed.
    update((all) => [{ id: b.next_job_id, input: text, since, confirmed: false, status: "Pending" }, ...all]);
    const result = await pay(price, { action: "job", input: text }, "Buy a safety check", "Check paid for", "Paid. The check is running, usually under a minute.");
    // Paid: the box empties, so pressing the button again never buys the same check twice by accident.
    if (result?.ok) setInput((now) => (now.trim() === text ? "" : now));
    const started = result?.events.find((event) => event.event === "job_started");
    const refunded = result?.events.find((event) => event.event === "job_refunded");
    if (result?.ok && started) {
      const id = started.data.job_id as number;
      const reason = refunded?.data.job_id === id ? String(refunded.data.reason) : undefined;
      update((all) => all.map((c) => (c.since === since && c.input === text ? { ...c, id, confirmed: true, ...(reason ? { reason, status: "Refunded" as const } : {}) } : c)));
    } else if (!result?.ok) {
      update((all) => all.filter((c) => !(c.since === since && c.input === text)));
    }
    await Promise.all([refresh(), balance.refresh()]);
  };

  const current = list[0];
  const earlier = list.slice(1);
  const now = clock || Math.floor(Date.now() / 1000);
  const refund = current?.status === "Refunded" ? refundText(current.reason, price) : null;

  return (
    <Panel featured={featured} title={`Buy a safety check, ${money(price)}`}>
      <p className="mb-4 text-[15px] leading-snug text-[var(--ink-2)]">
        A risk report on any NEAR account. Refunded if it fails.
        <Info label="safety check" tip={`${GLOSSARY.check} It runs on a sealed computer: ${GLOSSARY.sealedComputer}`} />
      </p>
      <ConnectGate quiet reason="Connect to buy one.">
        <form className="space-y-3" onSubmit={async (e) => { e.preventDefault(); await submit(input.trim()); }}>
          <div ref={inputRef}>
            <TextField label="Account to check" testId="job-input" value={input} onChange={setInput} placeholder={`an account name, e.g. ${EXAMPLES[0]!.account}`} error={inputError} />
          </div>
          <div className="space-y-2" aria-label="Examples" data-testid="job-examples">
            <p className="text-[14px] muted">Or try one:</p>
            <div className="flex flex-wrap gap-2">
              {EXAMPLES.map((example) => (
                <button key={example.account} type="button" className="example-chip whitespace-nowrap" onClick={() => setInput(example.account)} title={example.account}>
                  <span className="text-[var(--ink)]">{example.label}</span><span className="ml-1.5 muted">{example.account}</span>
                </button>
              ))}
            </div>
          </div>
          {missingNow ? <NoSuchAccount name={missingNow} /> : named && isAccountId(input.trim()) ? <FreeCheck account={input.trim().toLowerCase()} payer={account} /> : null}
          {short ? <p className="hint" data-error="true">You have {money(balance.data!)}; a check costs {money(price)}. Use Get test funds.</p> : null}
          {tankEmpty ? <p className="hint" data-error="true">Out of fees for checks. Anyone can top it up below.</p> : null}
          {!input.trim() && current ? (
            // After a check, the box is empty and the button starts the next one rather than paying again.
            <button type="button" data-testid="job-submit" className="btn btn-secondary w-full" onClick={() => inputRef.current?.querySelector("input")?.focus()}>Check another account</button>
          ) : (
            <button type="submit" data-testid="job-submit" className="btn btn-primary w-full" disabled={busy || !input.trim() || !named || !!inputError || !!missingNow || short || tankEmpty}>{!input.trim() ? "Type an account name first" : !named ? "Type an account name to check" : missingNow ? "Nothing to check: no such account" : `Pay ${money(price)} and run the check`}</button>
          )}
        </form>
      </ConnectGate>
      {current ? (
        <div className="inset appear mt-4" data-testid="job-result" aria-live="polite">
          {!isFinal(current) ? (
            <p className="flex items-start gap-2 text-[15px]">
              <span className="spinner spinner-ink mt-[3px] shrink-0" aria-hidden />
              <span>
                Checking <span className="font-medium break-all">{current.input}</span> ({duration(Math.max(0, now - current.since))} so far).{" "}
                {now - current.since > 120 ? "The network is slow; this can take minutes. Refunded if it fails." : "Usually under a minute, up to two."}
              </span>
            </p>
          ) : current.status === "Done" ? <ReportCard raw={current.report ?? null} ai={{ on: !!b.service.secrets_profile, loanOpen: !!b.current_loan }} /> : (
            <div className="space-y-3">
              <p className="text-[15px]">{refund!.text}</p>
              {refund!.retry ? <button type="button" className="btn btn-secondary btn-sm" disabled={busy || short} onClick={() => void submit(current.input)}>Try the same check again</button> : null}
            </div>
          )}
        </div>
      ) : null}
      {earlier.length ? (
        <div className="mt-4" data-testid="recent-checks">
          <p className="mb-2 text-[14px] muted">Your recent checks here</p>
          <ul className="space-y-1">
            {earlier.map((c) => {
              const level = c.status === "Done" ? parseReport(c.report ?? null)?.level : undefined;
              return (
                <li key={`${c.since}:${c.id}`} className="flex items-center justify-between gap-3 rounded-[10px] bg-[var(--surface-2)] px-3 py-2 text-[14px]">
                  <span className="min-w-0 truncate" title={c.input}>{c.input}</span>
                  <span className="shrink-0 text-[var(--ink-2)]">{c.status === "Done" ? (parseReport(c.report ?? null)?.flags.includes("account_does_not_exist") ? "No such account" : level ? `${level[0]!.toUpperCase()}${level.slice(1)} risk` : "Done") : c.status === "Refunded" ? "Refunded" : "Running"}</span>
                </li>
              );
            })}
          </ul>
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
  const foreclosed = loan.status === "Foreclosed";
  // The contract takes only what is owed and sends the rest back in the same transaction, so the
  // app never sends more than the debt (rounded up to the cent) in the first place.
  const all = centsUp(outstanding);
  const raw = checkAmount(text, {});
  const over = raw.value !== null && !raw.error && raw.value > all;
  // The balance is checked against what will actually be sent.
  const check = checkAmount(over ? inputAmount(all) : text, { balance: balance.data });
  const sending = check.value;
  return (
    <Panel title={foreclosed ? "Pay off the debt to stop the sale" : "Pay down the debt"}>
      <p className="mb-4 text-[15px] leading-snug text-[var(--ink-2)]">
        {foreclosed ? "Paying it all before the auction ends cancels the sale." : "Anyone can pay. It goes to lenders and counts at once."}
        <Info label="paying down" tip={foreclosed
          ? `Paying the full ${moneyUp(outstanding)} before the auction ends cancels the sale and gives the business back to its owner. Anyone can pay.`
          : `Anyone can pay, not only the owner. It goes to lenders and counts toward the next payment at once. ${moneyUp(outstanding)} is owed; the app never sends more than that.`} />
      </p>
      {!isOperator ? (
        <p className="mb-3 rounded-[10px] bg-[var(--surface-2)] px-4 py-3 text-[14px] leading-snug" data-testid="gift-note">Not your business: what you pay is a gift to its lenders.</p>
      ) : null}
      <ConnectGate quiet reason="Connect to pay.">
        <form className="space-y-3" onSubmit={async (e) => {
          e.preventDefault();
          if (!sending || check.error) return;
          const result = await pay(sending, { action: "repay" }, "Pay down the debt", "Payment received");
          if (result?.ok) setText("");
          await Promise.all([refresh(), balance.refresh()]);
        }}>
          <AmountField label="Amount" testId="repay-amount" value={text} onChange={setText} error={check.error} hint={over ? `Only ${moneyUp(outstanding)} is owed, so that is all that will be sent.` : undefined} />
          <div className="flex items-center justify-between gap-2">
            <button type="button" className="link text-[14px]" onClick={() => setText(inputAmount(all))}>Pay it all: {moneyUp(outstanding)}</button>
            <button type="submit" data-testid="repay-submit" className="btn btn-primary" disabled={busy || !sending || !!check.error}>{sending && !check.error ? `Pay ${money(sending)}` : "Pay"}</button>
          </div>
        </form>
        {isOperator && loan.status === "Active" && BigInt(b.ledger.opex) > 0n ? (
          <button type="button" className="btn btn-secondary mt-3 w-full" disabled={busy} data-testid="repay-opex" onClick={async () => {
            const available = BigInt(b.ledger.opex);
            const value = available < outstanding ? available : outstanding;
            await run(tx.repayFromOpex(b.id, value), { requiredOn: b.id, done: "Paid from the money kept for running costs" });
            await refresh();
          }}>
            Pay {BigInt(b.ledger.opex) < outstanding ? money(b.ledger.opex) : moneyUp(outstanding)} from its running-cost money
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
            <p className="mb-2 text-[15px]">Waiting for you: a refund, an outbid bid or a payout.</p>
            <button type="button" className="btn btn-primary w-full" disabled={busy} onClick={async () => { await run(tx.withdrawCredit(b.id, account), { done: "Paid out to you" }); await credit.refresh(); }}>Collect {money(owed)}</button>
          </div>
        ) : null}
        {list.map(({ loan, note }) => {
          const claimable = BigInt(note.claimable);
          const open = b.current_loan?.id === loan.id;
          return (
            <div key={loan.id} className="space-y-2">
              <dl className="dl">
                <dt>You lent{b.loan_count > 1 ? ` (loan ${loan.id + 1})` : ""}</dt><dd>{money(note.principal)}, {pctExact(share(note.principal, loan.terms.principal))} of the loan</dd>
                <dt>Collected so far</dt><dd>{money(note.claimed)}</dd>
                <dt>Ready to collect</dt><dd data-testid="claimable">{money(claimable)}</dd>
              </dl>
              {claimable > 0n ? (
                <button type="button" data-testid="claim" className="btn btn-primary w-full" disabled={busy} onClick={async () => {
                  await run(tx.claim(b.id, loan.id), { requiredOn: b.id, done: `Collected ${money(claimable)}` });
                  await Promise.all([positions.refresh(), credit.refresh(), refresh()]);
                }}>Collect {money(claimable)}</button>
              ) : <p className="text-[14px] text-[var(--ink-2)]">Nothing to collect yet; repayments arrive with each sale.</p>}
              {proposal && proposal.loan_id === loan.id && note.voted_proposal !== proposal.id ? (
                <div className="callout">
                  <p className="mb-2">New program proposed (build <code>{proposal.service.wasm.hash.slice(0, 12)}…</code>, price {money(proposal.service.price)}). {pct(share(proposal.approvals, loan.terms.principal))} agreed of the over 50% needed.</p>
                  <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={async () => { await run(tx.approveChange(b.id, proposal.id), { requiredOn: b.id, done: "Your approval is recorded" }); await Promise.all([positions.refresh(), refresh()]); }}>Approve the change</button>
                </div>
              ) : null}
              {open ? (
                <details className="text-[14px]">
                  <summary className="cursor-pointer py-2 text-[var(--ink-2)] hover:text-[var(--ink)]">Sell or give your share to someone else</summary>
                  <div className="mt-2"><ShareTransfer business={b.id} loanId={loan.id} lent={BigInt(note.principal)} ready={claimable} onDone={() => positions.refresh()} /></div>
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
  const locked = isTrapped(s);
  const withdrawCheck = checkAmount(withdraw, { max: opex });
  const priceCheck = checkAmount(price, { max: 1_000n * CENT * 100n });
  const priceValue = priceCheck.error ? null : priceCheck.value;
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
          {locked ? "Your share is locked until it catches up" : operatorShare === 0n ? (opex > 0n ? "No share of sales to withdraw yet (running-cost money is below)" : "No share of sales to withdraw yet") : `Withdraw your share: ${money(operatorShare)}`}
        </button>

        {loan?.status === "Funding" ? (
          <button type="button" className="btn btn-secondary w-full" disabled={busy} data-testid="cancel-offer" onClick={async () => { await run(tx.cancelOffer(b.id), { requiredOn: b.id, done: "Offer cancelled; lenders can take their money back" }); await refresh(); }}>Cancel this loan offer</button>
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
                <AmountField label="Amount" value={withdraw} onChange={setWithdraw} error={withdrawCheck.error} hint={`${money(opex)} available · only while it has no loan`} />
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
                <AmountField label="New price" value={price} onChange={setPrice} error={priceCheck.error} hint={`Now ${money(b.service.price)}. Up to $1,000.`} />
                <button className="btn btn-secondary btn-sm" disabled={busy || !priceValue}>Update</button>
              </form>
            </details>
          </>
        ) : null}

        {loan?.status === "Active" ? (
          <details>
            <summary className="cursor-pointer rounded-[10px] bg-[var(--surface-2)] px-4 py-3 text-[15px] font-medium transition-colors hover:bg-[var(--surface-3)]">Ask lenders to approve a new program</summary>
            {b.proposal ? (
              <p className="mt-3 text-[15px]">A change is waiting for lenders and has {pct(share(b.proposal.approvals, loan.terms.principal))} approval. It expires {fromNow(b.proposal.expires_at, now)}.</p>
            ) : (
              <form className="mt-3 space-y-2" onSubmit={async (e) => {
                e.preventDefault();
                if (!hashValid || !urlValid) return;
                await run(tx.proposeChange(b.id, { ...b.service, wasm: { ...b.service.wasm, url: newUrl, hash: newHash } }), { requiredOn: b.id, done: "Your proposal is open to lenders" });
                setNewHash("");
                setNewUrl("");
                await refresh();
              }}>
                <p className="hint">Frozen during a loan unless lenders holding over half agree.</p>
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
    return <p className="px-2 text-[14px] muted" data-testid="tank">Fees set aside for about {left.toString()} more checks.</p>;
  }
  return (
    <Panel title="Running low on fees for checks">
      <p className="mb-4 text-[15px] leading-snug text-[var(--ink-2)]">Fees for about {left.toString()} more checks ({nearAmount(b.tank)} <Term tip={GLOSSARY.near}>NEAR</Term> left).<Info label="check fees" tip="Without fees it cannot sell, and it will fall behind on its loan. Anyone can add more, and lenders have the most reason to." /></p>
      {account ? (
        <button type="button" className="btn btn-primary w-full" disabled={busy} onClick={async () => { await run(tx.fundTank(b.id, toYocto("1")), { requiredOn: b.id, done: "1 NEAR added for check fees" }); await refresh(); }}>Add 1 NEAR of fees</button>
      ) : null}
    </Panel>
  );
}
