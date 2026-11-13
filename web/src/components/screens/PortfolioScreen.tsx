"use client";

import Link from "next/link";
import { Fragment, useState } from "react";
import { ConnectButtons, useTx } from "@/components/Tx";
import { EmptyState, ErrorState, PageHead, Panel, Skeleton, StandingLabel } from "@/components/ui";
import { useLive } from "@/hooks/useLive";
import { money, share, smartAmount, symbol } from "@/lib/format";
import { claim, transferNote, withdrawCredit } from "@/lib/near/actions";
import { accountExists, getCredit, getLoans, getNote, listBusinesses } from "@/lib/near/rpc";
import type { Business, LoanStatus, LoanView, NoteView } from "@/lib/near/types";
import { standing } from "@/lib/status";
import { useWallet } from "@/lib/wallet/WalletProvider";

type Position = { business: Business; loan: LoanView; note: NoteView };
type Data = { positions: Position[]; credits: Array<{ business: Business; amount: bigint }>; operated: Business[]; unread: number };

const CLOSED: Partial<Record<LoanStatus, string>> = { Repaid: "Paid in full", Sold: "Foreclosed and sold", Cancelled: "Cancelled" };

/** Reads one business's loans and this account's place in them, retrying once if a node drops it. */
async function readOne(business: Business, account: string) {
  for (let attempt = 0; ; attempt++) {
    try {
      const [loans, credit] = await Promise.all([getLoans(business.id), getCredit(business.id, account)]);
      const notes = await Promise.all(loans.map(async (loan) => ({ loan, note: await getNote(business.id, loan.id, account) })));
      return { business, credit, positions: notes.flatMap(({ loan, note }) => (note ? [{ business, loan, note }] : [])) };
    } catch (error) {
      if (attempt >= 1) throw error;
    }
  }
}

async function load(account: string): Promise<Data> {
  // Every business is checked, test ones too, since a position can sit in any of them.
  // Small batches keep public RPC nodes from refusing a burst, and one unreadable
  // business never hides all the others.
  const businesses = await listBusinesses({ includeTests: true });
  const read: Awaited<ReturnType<typeof readOne>>[] = [];
  let unread = 0;
  for (let i = 0; i < businesses.length; i += 4) {
    const batch = await Promise.allSettled(businesses.slice(i, i + 4).map((b) => readOne(b, account)));
    for (const r of batch) {
      if (r.status === "fulfilled") read.push(r.value);
      else unread++;
    }
  }
  if (businesses.length > 0 && read.length === 0) throw new Error("Your positions could not be read from the network.");
  return {
    positions: read.flatMap((p) => p.positions),
    credits: read.filter((p) => p.credit > 0n).map((p) => ({ business: p.business, amount: p.credit })),
    operated: businesses.filter((b) => b.operator === account),
    unread,
  };
}

export function PortfolioScreen() {
  const { account, ready } = useWallet();
  const { run, busy } = useTx();
  const [moving, setMoving] = useState<string | null>(null);
  const live = useLive(account ? () => load(account) : null, `portfolio:${account}`, 12_000);

  if (ready && !account) {
    return (
      <div className="space-y-8">
        <PageHead title="Your positions" lead="What you have lent, what you can collect now, and the businesses you run." />
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
      <PageHead title="Your positions" lead={<span className="text-[15px] break-all muted">{account}</span>} />

      {live.error && !data ? <ErrorState message="Your positions could not be read from the network." onRetry={() => void live.refresh()} /> : !data ? (
        <div className="space-y-5" aria-busy="true"><Skeleton className="h-[170px] w-full" /><Skeleton className="h-[220px] w-full" /><Skeleton className="h-[120px] w-full" /></div>
      ) : (
        <>
          <Panel>
            <p className="text-[14px] muted">Ready to collect</p>
            <p className="num mt-1 text-[clamp(44px,5.4vw,64px)] leading-none font-medium tracking-[-0.03em]" data-testid="collect-total">{smartAmount(ready_to_collect)} <span className="text-[17px] font-normal tracking-normal muted">{symbol}</span></p>
            <p className="mt-3 text-[15px] text-[var(--ink-2)]">{data.positions.length ? `Across ${data.positions.length} ${data.positions.length === 1 ? "note" : "notes"}, ${money(lent)} lent in total.` : "You have not lent yet."}</p>
          </Panel>

          {data.credits.length ? (
            <Panel title="Waiting for you">
              <ul className="space-y-2">
                {data.credits.map(({ business, amount }) => (
                  <li key={business.id} className="flex items-center justify-between gap-3 rounded-[12px] bg-[var(--surface-2)] px-4 py-3 text-[15px]">
                    <span>{money(amount)} from <Link className="link" href={`/b/${business.id}`}>{business.name}</Link></span>
                    <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={async () => { await run(withdrawCredit(business.id, account!), { done: "Paid out" }); await live.refresh(); }}>Collect</button>
                  </li>
                ))}
              </ul>
            </Panel>
          ) : null}

          {data.unread > 0 ? <p role="status" className="rounded-[12px] bg-[var(--surface-2)] p-4 text-[15px]">{data.unread} {data.unread === 1 ? "business" : "businesses"} could not be read just now, so a position there may be missing. This page checks again every few seconds.</p> : null}
          <Panel title="Notes" aside={`${data.positions.length}`}>
            {data.positions.length === 0 ? <EmptyState title="No notes yet" body="Lend to a business that is raising and your note appears here, with every sale's share ready to collect." action={{ href: "/market", label: "See what is raising" }} /> : (
              <div className="-mx-[18px] sm:-mx-[22px] overflow-x-auto">
                <table className="table min-w-[680px]" data-testid="notes-table">
                  <thead><tr><th scope="col">Business</th><th scope="col">Standing</th><th scope="col" className="r">Lent</th><th scope="col" className="r">Your share</th><th scope="col" className="r">Collected</th><th scope="col" className="r">Ready</th><th scope="col"><span className="sr-only">Collect</span></th></tr></thead>
                  <tbody>
                    {data.positions.map(({ business, loan, note }) => {
                      const ready = BigInt(note.claimable);
                      const open = business.current_loan?.id === loan.id;
                      return (
                        <Fragment key={`${business.id}:${loan.id}`}>
                        <tr>
                          <td><Link className="font-medium hover:underline" href={`/b/${business.id}`}>{business.name}</Link><div className="text-[13px] muted">Loan {loan.id + 1}</div></td>
                          <td>{open ? <StandingLabel standing={standing(business)} /> : <span className="chip">{CLOSED[loan.status] ?? loan.status}</span>}</td>
                          <td className="r">{smartAmount(note.principal)}</td>
                          <td className="r">{share(note.principal, loan.funded)}%</td>
                          <td className="r">{smartAmount(note.claimed)}</td>
                          <td className="r">{smartAmount(ready)}</td>
                          <td className="text-right whitespace-nowrap"><button type="button" className={`btn btn-sm ${ready === 0n ? "btn-secondary" : "btn-primary"}`} disabled={busy || ready === 0n} onClick={async () => { await run(claim(business.id, loan.id), { requiredOn: business.id, done: `Collected ${money(ready)}` }); await live.refresh(); }}>Collect</button>{" "}<button type="button" className="btn btn-sm btn-secondary" aria-expanded={moving === `${business.id}:${loan.id}`} onClick={() => setMoving(moving === `${business.id}:${loan.id}` ? null : `${business.id}:${loan.id}`)}>Transfer</button></td>
                        </tr>
                        {moving === `${business.id}:${loan.id}` ? (
                          <tr><td colSpan={7}><TransferNote business={business.id} loanId={loan.id} ready={ready} onDone={async () => { setMoving(null); await live.refresh(); }} /></td></tr>
                        ) : null}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>

          <Panel title="Businesses you run" aside={`${data.operated.length}`}>
            {data.operated.length === 0 ? <EmptyState title="You run no businesses yet" body="Start one in a minute: a keyless account that sells its work and can borrow against its sales." action={{ href: "/create", label: "Start a business" }} /> : (
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

/** Sells or moves a note: the whole position, including anything not yet collected, goes to the other account. */
function TransferNote({ business, loanId, ready, onDone }: { business: string; loanId: number; ready: bigint; onDone: () => Promise<void> }) {
  const { run, busy } = useTx();
  const { account } = useWallet();
  const [to, setTo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const id = to.trim().toLowerCase();
    setError(null);
    if (!/^(?=.{2,64}$)(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/.test(id)) return setError("Write a NEAR account, like buyer.testnet.");
    if (id === account) return setError("That is your own account.");
    if (!(await accountExists(id).catch(() => true))) return setError("That account does not exist on this network.");
    const result = await run(transferNote(business, loanId, id), { requiredOn: business, done: `Note sent to ${id}` });
    if (result?.ok) await onDone();
  };
  return (
    <form onSubmit={submit} className="grid gap-3 rounded-[12px] bg-[var(--surface-2)] p-4 sm:grid-cols-[1fr_auto] sm:items-end" data-testid="transfer-note">
      <div className="grid gap-2">
        <label htmlFor={`to-${business}-${loanId}`} className="text-[14px]">Send this note to</label>
        <input id={`to-${business}-${loanId}`} className="input" value={to} onChange={(e) => setTo(e.target.value)} placeholder="buyer.testnet" autoComplete="off" spellCheck={false} aria-invalid={!!error} aria-describedby={`to-help-${business}-${loanId}`} />
        <p id={`to-help-${business}-${loanId}`} className={`text-[14px] ${error ? "text-[var(--danger)]" : "muted"}`}>
          {error ?? (ready > 0n ? `Collect the ${money(ready)} that is ready first: anything not collected moves with the note.` : "The whole position moves, with every future share of sales. Agree a price with the buyer first.")}
        </p>
      </div>
      <button type="submit" className="btn btn-primary" disabled={busy || !to.trim()}>Send the note</button>
    </form>
  );
}
