"use client";

import Link from "next/link";
import { ConnectButtons, useTx } from "@/components/Tx";
import { EmptyState, ErrorState, PageHead, Panel, Skeleton, StandingLabel } from "@/components/ui";
import { useLive } from "@/hooks/useLive";
import { money, share, smartAmount, symbol } from "@/lib/format";
import { claim, withdrawCredit } from "@/lib/near/actions";
import { getCredit, getLoans, getNote, listBusinesses } from "@/lib/near/rpc";
import type { Business, LoanStatus, LoanView, NoteView } from "@/lib/near/types";
import { standing } from "@/lib/status";
import { useWallet } from "@/lib/wallet/WalletProvider";

type Position = { business: Business; loan: LoanView; note: NoteView };
type Data = { positions: Position[]; credits: Array<{ business: Business; amount: bigint }>; operated: Business[] };

const CLOSED: Partial<Record<LoanStatus, string>> = { Repaid: "Paid in full", Sold: "Foreclosed and sold", Cancelled: "Cancelled" };

async function load(account: string): Promise<Data> {
  const businesses = await listBusinesses({ includeTests: true });
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
                        <tr key={`${business.id}:${loan.id}`}>
                          <td><Link className="font-medium hover:underline" href={`/b/${business.id}`}>{business.name}</Link><div className="text-[13px] muted">Loan {loan.id + 1}</div></td>
                          <td>{open ? <StandingLabel standing={standing(business)} /> : <span className="chip">{CLOSED[loan.status] ?? loan.status}</span>}</td>
                          <td className="r">{smartAmount(note.principal)}</td>
                          <td className="r">{share(note.principal, loan.funded)}%</td>
                          <td className="r">{smartAmount(note.claimed)}</td>
                          <td className="r">{smartAmount(ready)}</td>
                          <td className="text-right"><button type="button" className={`btn btn-sm ${ready === 0n ? "btn-secondary" : "btn-primary"}`} disabled={busy || ready === 0n} onClick={async () => { await run(claim(business.id, loan.id), { requiredOn: business.id, done: `Collected ${money(ready)}` }); await live.refresh(); }}>Collect</button></td>
                        </tr>
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
