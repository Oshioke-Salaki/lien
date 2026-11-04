"use client";

import Link from "next/link";
import { ConnectButtons, useTx } from "@/components/Tx";
import { ErrorState, Panel, Skeleton } from "@/components/ui";
import { useLive } from "@/hooks/useLive";
import { money, share, smartAmount, symbol } from "@/lib/format";
import { claim, withdrawCredit } from "@/lib/near/actions";
import { getCredit, getLoans, getNote, listBusinesses } from "@/lib/near/rpc";
import type { Business, LoanStatus, LoanView, NoteView } from "@/lib/near/types";
import { STANDING_LABEL, standing } from "@/lib/status";
import { useWallet } from "@/lib/wallet/WalletProvider";

type Position = { business: Business; loan: LoanView; note: NoteView };
type Data = { positions: Position[]; credits: Array<{ business: Business; amount: bigint }>; operated: Business[] };

const CLOSED: Partial<Record<LoanStatus, string>> = { Repaid: "Paid in full", Sold: "Foreclosed and sold", Cancelled: "Cancelled" };

async function load(account: string): Promise<Data> {
  const businesses = await listBusinesses();
  const perBusiness = await Promise.all(
    businesses.map(async (business) => {
      const [loans, credit] = await Promise.all([getLoans(business.id), getCredit(business.id, account)]);
      const notes = await Promise.all(loans.map(async (loan) => ({ loan, note: await getNote(business.id, loan.id, account) })));
      return {
        business,
        credit,
        positions: notes.flatMap(({ loan, note }) => (note ? [{ business, loan, note }] : [])),
      };
    }),
  );
  return {
    positions: perBusiness.flatMap((p) => p.positions),
    credits: perBusiness.filter((p) => p.credit > 0n).map((p) => ({ business: p.business, amount: p.credit })),
    operated: businesses.filter((b) => b.operator === account),
  };
}

export function PortfolioScreen() {
  const { account, ready } = useWallet();
  const { run, busy } = useTx();
  const live = useLive(account ? () => load(account) : null, `portfolio:${account}`, 12_000);

  if (ready && !account) {
    return (
      <div className="space-y-4">
        <h1 className="text-[28px] font-medium tracking-[-0.01em]">Your positions</h1>
        <p className="text-[17px]">Connect to see what you have lent, what you can collect and the businesses you run.</p>
        <ConnectButtons />
      </div>
    );
  }

  const data = live.data;
  const claimable = data?.positions.reduce((sum, p) => sum + BigInt(p.note.claimable), 0n) ?? 0n;
  const owed = data?.credits.reduce((sum, c) => sum + c.amount, 0n) ?? 0n;
  const lent = data?.positions.reduce((sum, p) => sum + BigInt(p.note.principal), 0n) ?? 0n;
  const ready_to_collect = claimable + owed;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[28px] leading-tight font-medium tracking-[-0.01em]">Your positions</h1>
        <p className="mt-1 text-[14px] muted">{account}</p>
      </div>

      {live.error && !data ? <ErrorState message="Your positions could not be read from the network." onRetry={() => void live.refresh()} /> : !data ? <Skeleton className="h-48 w-full" /> : (
        <>
          <Panel>
            <p className="text-[14px] muted">Ready to collect</p>
            <p className="num text-[48px] leading-none font-medium tracking-[-0.02em]" data-testid="collect-total">{smartAmount(ready_to_collect)} <span className="text-[17px] font-normal muted">{symbol}</span></p>
            <p className="mt-2 text-[15px]">{data.positions.length ? `Across ${data.positions.length} ${data.positions.length === 1 ? "note" : "notes"}, ${money(lent)} lent in total.` : "You have not lent yet."} {data.positions.length ? null : <Link className="link" href="/market">See what is raising</Link>}</p>
          </Panel>

          {data.credits.length ? (
            <Panel title="Waiting for you">
              <ul className="space-y-2">
                {data.credits.map(({ business, amount }) => (
                  <li key={business.id} className="flex items-center justify-between gap-3 text-[15px]">
                    <span>{money(amount)} from <Link className="link" href={`/b/${business.id}`}>{business.name}</Link></span>
                    <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={async () => { await run(withdrawCredit(business.id, account!), { done: "Paid out" }); await live.refresh(); }}>Collect</button>
                  </li>
                ))}
              </ul>
            </Panel>
          ) : null}

          <Panel title="Notes" aside={`${data.positions.length}`}>
            {data.positions.length === 0 ? <p className="py-3 muted">Notes you hold will appear here.</p> : (
              <div className="-mx-[18px] overflow-x-auto">
                <table className="table min-w-[680px]" data-testid="notes-table">
                  <thead><tr><th scope="col">Business</th><th scope="col">Standing</th><th scope="col" className="r">Lent</th><th scope="col" className="r">Your share</th><th scope="col" className="r">Collected</th><th scope="col" className="r">Ready</th><th scope="col"><span className="sr-only">Collect</span></th></tr></thead>
                  <tbody>
                    {data.positions.map(({ business, loan, note }) => {
                      const ready = BigInt(note.claimable);
                      const open = business.current_loan?.id === loan.id;
                      return (
                        <tr key={`${business.id}:${loan.id}`}>
                          <td><Link className="font-medium hover:underline" href={`/b/${business.id}`}>{business.name}</Link><div className="text-[13px] muted">Loan {loan.id + 1}</div></td>
                          <td>{open ? STANDING_LABEL[standing(business)] : (CLOSED[loan.status] ?? loan.status)}</td>
                          <td className="r">{smartAmount(note.principal)}</td>
                          <td className="r">{share(note.principal, loan.funded)}%</td>
                          <td className="r">{smartAmount(note.claimed)}</td>
                          <td className="r">{smartAmount(ready)}</td>
                          <td className="text-right"><button type="button" className="btn btn-secondary btn-sm" disabled={busy || ready === 0n} onClick={async () => { await run(claim(business.id, loan.id), { requiredOn: business.id, done: `Collected ${money(ready)}` }); await live.refresh(); }}>Collect</button></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>

          <Panel title="Businesses you run" aside={`${data.operated.length}`}>
            {data.operated.length === 0 ? <p className="py-3 muted">None yet. <Link className="link" href="/create">Start one</Link>.</p> : (
              <ul className="divide-y divide-[var(--line)]">
                {data.operated.map((b) => (
                  <li key={b.id} className="flex items-center justify-between gap-3 py-3 text-[15px]">
                    <Link className="font-medium hover:underline" href={`/b/${b.id}`}>{b.name}</Link>
                    <span>{STANDING_LABEL[standing(b)]}</span>
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
