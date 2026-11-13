"use client";

import { Panel } from "@/components/ui";
import { useLive } from "@/hooks/useLive";
import { dateTime, money } from "@/lib/format";
import { getLoans } from "@/lib/near/rpc";
import type { Business, LoanStatus } from "@/lib/near/types";

const WORD: Record<LoanStatus, string> = { Funding: "Raising", Active: "Open", Repaid: "Paid in full", Foreclosed: "Taken over, for sale", Sold: "Taken over and sold", Cancelled: "Cancelled" };

/** A lender's first question about a borrower: how did its past loans end? */
export function HistoryPanel({ business: b }: { business: Business }) {
  const live = useLive(() => getLoans(b.id), `loans:${b.id}:${b.loan_count}:${b.current_loan?.status}`, 0);
  const loans = live.data ?? [];
  if (!live.loaded || loans.length === 0) return null;
  return (
    <Panel title="Loan history" aside={`${loans.length} ${loans.length === 1 ? "loan" : "loans"}`}>
      <div className="overflow-x-auto">
        <table className="table table-fixed">
          <thead><tr><th scope="col" className="w-[56px]">Loan</th><th scope="col">Outcome</th><th scope="col" className="r w-[96px]">Borrowed</th><th scope="col" className="r w-[140px]">Lenders got back</th><th scope="col" className="r hidden w-[150px] sm:table-cell">Closed</th></tr></thead>
          <tbody>
            {loans.map((loan) => (
              <tr key={loan.id}>
                <td>{loan.id + 1}</td>
                <td className="truncate">{WORD[loan.status]}</td>
                <td className="r">{money(loan.terms.principal)}</td>
                <td className="r">{loan.status === "Funding" || loan.status === "Cancelled" ? <span className="muted">-</span> : `${money(loan.repaid)} of ${money(loan.terms.total_due)}`}</td>
                <td className="r hidden whitespace-nowrap sm:table-cell">{loan.closed_at ? dateTime(loan.closed_at) : <span className="muted">-</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
