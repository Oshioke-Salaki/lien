"use client";

import Link from "next/link";
import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { ConnectButtons, useTx } from "@/components/Tx";
import { EmptyState, ErrorState, PageHead, Panel, Skeleton, StandingLabel } from "@/components/ui";
import { REFRESH_EVENT } from "@/lib/events";
import { dateTime, money, pct, share } from "@/lib/format";
import { claim, withdrawCredit } from "@/lib/near/actions";
import { ShareTransfer } from "@/components/business/ShareTransfer";
import { fetchPositions } from "@/lib/snapshotClient";
import type { PositionsSnapshot } from "@/lib/snapshot";
import type { Business, LoanStatus, LoanView, NoteView } from "@/lib/near/types";
import { standing } from "@/lib/status";
import { useWallet } from "@/lib/wallet/WalletProvider";

type Position = { business: Business; loan: LoanView; note: NoteView };
type Data = { positions: Position[]; credits: Array<{ business: Business; amount: bigint }>; operated: Business[]; bids: Business[]; unread: number };

const CLOSED: Partial<Record<LoanStatus, string>> = { Repaid: "Paid in full", Sold: "Taken over and sold", Cancelled: "Cancelled" };

/** The server's snapshot, turned back into the shapes this page renders. */
function toData(snapshot: PositionsSnapshot): Data {
  const byId = new Map(snapshot.businesses.map((b) => [b.id, b]));
  const pick = (ids: string[]) => ids.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));
  return {
    positions: snapshot.positions.flatMap((p) => (byId.has(p.businessId) ? [{ business: byId.get(p.businessId)!, loan: p.loan, note: p.note }] : [])),
    credits: snapshot.credits.flatMap((c) => (byId.has(c.businessId) ? [{ business: byId.get(c.businessId)!, amount: BigInt(c.amount) }] : [])),
    operated: pick(snapshot.operated),
    bids: pick(snapshot.bids),
    unread: snapshot.unread,
  };
}

/**
 * Positions, read by the server in one request (lib/snapshot.ts) instead of dozens of RPC
 * calls from this browser, re-read after every transaction and every 15 seconds. If the
 * server ran out of time, it says how far it got and the next read carries on.
 */
function usePositions(account: string | null) {
  const [state, setState] = useState<{ for: string | null; data?: Data; checked: number; total: number; error?: string }>({ for: null, checked: 0, total: 0 });
  const generation = useRef(0);
  const refresh = useCallback(async () => {
    if (!account) return;
    const mine = ++generation.current;
    try {
      const snapshot = await fetchPositions(account);
      if (mine === generation.current) setState({ for: account, data: toData(snapshot), checked: snapshot.checked, total: snapshot.total });
    } catch (error) {
      if (mine === generation.current) setState((s) => ({ ...s, for: account, error: error instanceof Error ? error.message : String(error) }));
    }
  }, [account]);
  useEffect(() => {
    void refresh();
    const now = () => void refresh();
    window.addEventListener(REFRESH_EVENT, now);
    const timer = setInterval(() => { if (document.visibilityState === "visible") void refresh(); }, 15_000);
    return () => { window.removeEventListener(REFRESH_EVENT, now); clearInterval(timer); };
  }, [refresh]);
  const current = state.for === account ? state : { data: undefined, checked: 0, total: 0, error: undefined };
  return { data: current.data, checked: current.checked, total: current.total, error: current.error, refresh };
}

export function PortfolioScreen() {
  const { account, ready } = useWallet();
  const { run, busy } = useTx();
  const [moving, setMoving] = useState<string | null>(null);
  const live = usePositions(account);

  if (ready && !account) {
    return (
      <div className="space-y-8">
        <PageHead title="Your positions" lead="Everything you have in Lien: money you lent, repayments ready to collect, your bids and the businesses you own." />
        <section className="panel max-w-[620px] p-6">
          <h2 className="text-[20px] font-medium tracking-[-0.01em]">Connect to see your positions</h2>
          <p className="mt-2 mb-5 text-[15px] leading-snug text-[var(--ink-2)]">Use your NEAR wallet, or a free test account that lives in this browser. Nothing is signed until you press a button.</p>
          <ConnectButtons />
        </section>
      </div>
    );
  }

  const data = live.data;
  const claimable = data?.positions.reduce((sum, p) => sum + BigInt(p.note.claimable), 0n) ?? 0n;
  const owed = data?.credits.reduce((sum, c) => sum + c.amount, 0n) ?? 0n;
  const lent = data?.positions.reduce((sum, p) => sum + BigInt(p.note.principal), 0n) ?? 0n;
  const ready_to_collect = claimable + owed;

  return (
    <div className="space-y-6">
      <PageHead title="Your positions" lead="Money you lent, repayments ready to collect, your bids and the businesses you own." />

      {live.error && !data ? <ErrorState message="Your positions could not be read from the network." onRetry={() => void live.refresh()} /> : !data ? (
        <div className="space-y-5" aria-busy="true"><Skeleton className="h-[170px] w-full" /><Skeleton className="h-[220px] w-full" /><Skeleton className="h-[120px] w-full" /></div>
      ) : (
        <>
          <Panel>
            <p className="text-[14px] muted">Ready to collect</p>
            <p className="num mt-1 text-[clamp(44px,5.4vw,64px)] leading-none font-medium tracking-[-0.03em]" data-testid="collect-total">{money(ready_to_collect)}</p>
            <p className="mt-3 text-[15px] text-[var(--ink-2)]">{data.positions.length ? `You lent ${money(lent)} in total, across ${data.positions.length} ${data.positions.length === 1 ? "loan" : "loans"}. Repayments arrive with every sale those businesses make; collect them any time.` : "You have not lent yet."}</p>
          </Panel>

          {data.credits.length ? (
            <Panel title="Waiting for you: refunds, outbid bids and payouts">
              <ul className="space-y-2">
                {data.credits.map(({ business, amount }) => (
                  <li key={business.id} className="flex items-center justify-between gap-3 rounded-[12px] bg-[var(--surface-2)] px-4 py-3 text-[15px]">
                    <span>{money(amount)} from <Link className="link" href={`/b/${business.id}`}>{business.name}</Link></span>
                    <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={async () => { await run(withdrawCredit(business.id, account!), { done: "Paid out to you" }); await live.refresh(); }}>Collect</button>
                  </li>
                ))}
              </ul>
            </Panel>
          ) : null}

          {live.checked < live.total ? <p role="status" className="flex items-center gap-2 rounded-[12px] bg-[var(--surface-2)] p-4 text-[15px]" data-testid="positions-checking"><span className="spinner spinner-ink" aria-hidden />Checked {live.checked} of {live.total} businesses so far; the rest are read on the next refresh.</p> : null}
          {data.unread > 0 ? <p role="status" className="rounded-[12px] bg-[var(--surface-2)] p-4 text-[15px]">{data.unread} {data.unread === 1 ? "business" : "businesses"} could not be read just now, so a position there may be missing. This page checks again every few seconds.</p> : null}
          {data.bids.length ? (
            <Panel title="Your bids" aside={`${data.bids.length}`}>
              <ul className="space-y-2" data-testid="bids">
                {data.bids.map((b) => (
                  <li key={b.id}>
                    <Link className="flex flex-wrap items-center justify-between gap-3 rounded-[12px] bg-[var(--surface-2)] px-4 py-3 text-[15px] transition-colors hover:bg-[var(--surface-3)]" href={`/b/${b.id}`}>
                      <span><span className="font-medium">{b.name}</span>: you are the highest bidder at {money(b.current_loan!.auction.high_bid)}</span>
                      <span className="text-[14px] muted">{b.current_loan!.auction.ends_at ? `Ends ${dateTime(b.current_loan!.auction.ends_at)}` : ""}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </Panel>
          ) : null}

          <Panel title="Money you lent" aside={`${data.positions.length} ${data.positions.length === 1 ? "loan" : "loans"}`}>
            {data.positions.length === 0 ? <EmptyState title="You have not lent yet" body="Lend to a business that is raising money. Your share of the loan appears here, with repayments from every sale ready to collect." action={{ href: "/market", label: "See what is raising" }} /> : (
              <>
              {/* Phones: one card per loan, so nothing scrolls sideways. */}
              <ul className="space-y-3 sm:hidden" data-testid="notes-cards">
                {data.positions.map(({ business, loan, note }) => {
                  const ready = BigInt(note.claimable);
                  const open = business.current_loan?.id === loan.id;
                  const key = `${business.id}:${loan.id}`;
                  return (
                    <li key={key} className="space-y-3 rounded-[14px] bg-[var(--surface-2)] p-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <Link className="font-medium hover:underline" href={`/b/${business.id}`}>{business.name}</Link>
                        {open ? <StandingLabel standing={standing(business)} /> : <span className="chip">{CLOSED[loan.status] ?? loan.status}</span>}
                      </div>
                      <dl className="dl text-[15px]">
                        <dt>You lent</dt><dd>{money(note.principal)}</dd>
                        <dt>Share of the loan</dt><dd>{pct(share(note.principal, loan.terms.principal))}</dd>
                        <dt>Collected</dt><dd>{money(note.claimed)}</dd>
                        <dt>Ready to collect</dt><dd>{money(ready)}</dd>
                      </dl>
                      <div className="flex flex-wrap gap-2">
                        {ready > 0n ? <button type="button" className="btn btn-sm btn-primary" disabled={busy} onClick={async () => { await run(claim(business.id, loan.id), { requiredOn: business.id, done: `Collected ${money(ready)}` }); await live.refresh(); }}>Collect {money(ready)}</button> : <span className="text-[14px] muted">Nothing to collect yet</span>}
                        <button type="button" className="btn btn-sm btn-secondary" aria-expanded={moving === key} onClick={() => setMoving(moving === key ? null : key)}>Transfer</button>
                      </div>
                      {moving === key ? <ShareTransfer business={business.id} loanId={loan.id} lent={BigInt(note.principal)} ready={ready} onDone={async () => { setMoving(null); await live.refresh(); }} /> : null}
                    </li>
                  );
                })}
              </ul>
              <div className="hidden w-full overflow-x-auto sm:block">
                <table className="table min-w-[680px]" data-testid="notes-table">
                  <thead><tr><th scope="col">Business</th><th scope="col">How it is doing</th><th scope="col" className="r">You lent</th><th scope="col" className="r">Share of the loan</th><th scope="col" className="r">Collected</th><th scope="col" className="r">Ready</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
                  <tbody>
                    {data.positions.map(({ business, loan, note }) => {
                      const ready = BigInt(note.claimable);
                      const open = business.current_loan?.id === loan.id;
                      return (
                        <Fragment key={`${business.id}:${loan.id}`}>
                        <tr>
                          <td><Link className="font-medium hover:underline" href={`/b/${business.id}`}>{business.name}</Link><div className="text-[13px] muted">Loan {loan.id + 1}</div></td>
                          <td>{open ? <StandingLabel standing={standing(business)} /> : <span className="chip">{CLOSED[loan.status] ?? loan.status}</span>}</td>
                          <td className="r">{money(note.principal)}</td>
                          <td className="r">{pct(share(note.principal, loan.terms.principal))}</td>
                          <td className="r">{money(note.claimed)}</td>
                          <td className="r">{money(ready)}</td>
                          <td className="text-right whitespace-nowrap">{ready > 0n ? <button type="button" className="btn btn-sm btn-primary" disabled={busy} onClick={async () => { await run(claim(business.id, loan.id), { requiredOn: business.id, done: `Collected ${money(ready)}` }); await live.refresh(); }}>Collect</button> : <span className="text-[14px] muted">Nothing yet</span>}{" "}<button type="button" className="btn btn-sm btn-secondary" aria-expanded={moving === `${business.id}:${loan.id}`} onClick={() => setMoving(moving === `${business.id}:${loan.id}` ? null : `${business.id}:${loan.id}`)}>Transfer</button></td>
                        </tr>
                        {moving === `${business.id}:${loan.id}` ? (
                          <tr><td colSpan={7}><ShareTransfer business={business.id} loanId={loan.id} lent={BigInt(note.principal)} ready={ready} onDone={async () => { setMoving(null); await live.refresh(); }} /></td></tr>
                        ) : null}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              </>
            )}
          </Panel>

          <Panel title="Businesses you own" aside={`${data.operated.length}`}>
            {data.operated.length === 0 ? <EmptyState title="You own no businesses yet" body="Start one in a minute: an AI agent that sells a service and can borrow against its sales." action={{ href: "/create", label: "Start a business" }} /> : (
              <ul className="space-y-2">
                {data.operated.map((b) => (
                  <li key={b.id}>
                    <Link className="flex items-center justify-between gap-3 rounded-[12px] bg-[var(--surface-2)] px-4 py-3 text-[15px] transition-colors hover:bg-[var(--surface-3)]" href={`/b/${b.id}`}>
                      <span className="font-medium">{b.name}</span>
                      <StandingLabel standing={standing(b)} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </>
      )}
    </div>
  );
}
