// What the market and the positions page show, read once on the server and shared by every
// visitor for a few seconds. A browser asking a dozen public RPC nodes for every business
// on every poll gets throttled (429s, CORS-blocked retries); one cached server read does not.
// Every figure still comes from the contracts' own views.

import { listBusinesses, getCredit, getJobs, getLoans, getNote, isTestRun } from "./near/rpc";
import type { Business, LoanView, NoteView } from "./near/types";
import { isTeamSample } from "./demo";

export type Activity = { at: number; businessId: string; businessName: string; text: string; key: string };

/** Lifetime figures across every listed business. Amounts are base-unit strings. */
export type MarketStats = {
  businesses: number;
  lentNow: string;
  lentAllTime: string;
  repaidAllTime: string;
  loansRepaid: number;
  loansTakenOver: number;
  /** Repaid to lenders on loans that have closed, against what those loans owed. */
  closedRecovered: string;
  closedDue: string;
  checksSold: number;
};

export type MarketSnapshot = { businesses: Business[]; stats: MarketStats; activity: Activity[]; at: number };

const money = (units: string | bigint) => {
  const v = BigInt(units);
  const cents = (v + 5_000n) / 10_000n;
  return `$${(cents / 100n).toLocaleString("en-US")}.${(cents % 100n).toString().padStart(2, "0")}`;
};

function activityFor(b: Business, loans: LoanView[], jobs: Awaited<ReturnType<typeof getJobs>>): Activity[] {
  const items: Activity[] = [];
  const base = { businessId: b.id, businessName: b.name };
  for (const job of jobs.slice(0, 4)) {
    if (job.status === "Done") items.push({ ...base, at: Number(job.created_at), key: `${b.id}:job:${job.id}`, text: `sold a safety check for ${money(job.paid)}, and its lenders were paid their share` });
    else if (job.status === "Refunded") items.push({ ...base, at: Number(job.created_at), key: `${b.id}:job:${job.id}`, text: `refunded a check that couldn't finish (${money(job.paid)} back to the buyer)` });
  }
  for (const loan of loans.slice(0, 3)) {
    const size = money(loan.terms.principal);
    items.push({ ...base, at: loan.created_at, key: `${b.id}:loan:${loan.id}:offer`, text: `asked lenders for a ${size} loan` });
    if (loan.activated_at) items.push({ ...base, at: loan.activated_at, key: `${b.id}:loan:${loan.id}:active`, text: `raised its ${size} loan in full` });
    if (loan.foreclosed_at) items.push({ ...base, at: loan.foreclosed_at, key: `${b.id}:loan:${loan.id}:taken`, text: "was taken over for its lenders after missing payments" });
    if (loan.closed_at && loan.status === "Repaid") items.push({ ...base, at: loan.closed_at, key: `${b.id}:loan:${loan.id}:repaid`, text: `paid back its ${size} loan in full` });
    if (loan.closed_at && loan.status === "Sold") items.push({ ...base, at: loan.closed_at, key: `${b.id}:loan:${loan.id}:sold`, text: `was sold at auction; lenders recovered ${money(loan.repaid)} of ${money(loan.terms.total_due)}` });
  }
  return items;
}

/** Featured on the market: the team's own samples, and any business real customers use. */
export const isFeatured = (b: Business) => isTeamSample(b) || b.stats.unique_payers >= 3;

export async function readMarket(): Promise<MarketSnapshot> {
  const businesses = await listBusinesses();
  const per = await Promise.allSettled(
    businesses.map(async (b) => {
      const [loans, jobs] = await Promise.all([getLoans(b.id, 50), isFeatured(b) ? getJobs(b.id, 4) : Promise.resolve([])]);
      return { b, loans, jobs };
    }),
  );
  let lentNow = 0n, lentAllTime = 0n, repaidAllTime = 0n, closedRecovered = 0n, closedDue = 0n;
  let loansRepaid = 0, loansTakenOver = 0;
  const activity: Activity[] = [];
  for (const r of per) {
    if (r.status !== "fulfilled") continue;
    const { b, loans, jobs } = r.value;
    for (const loan of loans) {
      if (loan.status === "Funding" || loan.status === "Cancelled") continue;
      lentAllTime += BigInt(loan.funded);
      repaidAllTime += BigInt(loan.repaid);
      if (loan.status === "Active" || loan.status === "Foreclosed") lentNow += BigInt(loan.funded);
      if (loan.status === "Repaid") loansRepaid++;
      if (loan.foreclosed_at) loansTakenOver++;
      if (loan.status === "Repaid" || loan.status === "Sold") {
        closedRecovered += BigInt(loan.repaid);
        closedDue += BigInt(loan.terms.total_due);
      }
    }
    if (isFeatured(b)) activity.push(...activityFor(b, loans, jobs));
  }
  return {
    businesses,
    stats: {
      businesses: businesses.length,
      lentNow: lentNow.toString(),
      lentAllTime: lentAllTime.toString(),
      repaidAllTime: repaidAllTime.toString(),
      loansRepaid,
      loansTakenOver,
      closedRecovered: closedRecovered.toString(),
      closedDue: closedDue.toString(),
      checksSold: businesses.reduce((sum, b) => sum + b.stats.jobs_done, 0),
    },
    activity: activity.sort((a, b) => b.at - a.at).slice(0, 8),
    at: Math.floor(Date.now() / 1000),
  };
}

export type PositionJson = { businessId: string; loan: LoanView; note: NoteView };
export type PositionsSnapshot = {
  businesses: Business[];
  positions: PositionJson[];
  credits: Array<{ businessId: string; amount: string }>;
  operated: string[];
  bids: string[];
  checked: number;
  total: number;
  unread: number;
  at: number;
};

/**
 * Everything one account holds, across every business (test ones too, since a position can
 * sit anywhere). Read in batches within a time budget: a partial answer, with how far it got,
 * beats a page that waits forever.
 */
export async function readPositions(account: string, budgetMs = 20_000): Promise<PositionsSnapshot> {
  const started = Date.now();
  const businesses = await listBusinesses({ includeTests: true });
  const ordered = [...businesses].sort((a, b) => Number(isTestRun(a.id)) - Number(isTestRun(b.id)));
  const positions: PositionJson[] = [];
  const credits: Array<{ businessId: string; amount: string }> = [];
  const held = new Set<string>();
  let checked = 0, unread = 0;
  for (let i = 0; i < ordered.length; i += 6) {
    if (Date.now() - started > budgetMs) break;
    const batch = await Promise.allSettled(
      ordered.slice(i, i + 6).map(async (b) => {
        const [loans, credit] = await Promise.all([getLoans(b.id), getCredit(b.id, account)]);
        const notes = await Promise.all(loans.map(async (loan) => ({ loan, note: await getNote(b.id, loan.id, account) })));
        return { b, credit, notes };
      }),
    );
    for (const r of batch) {
      checked++;
      if (r.status !== "fulfilled") { unread++; continue; }
      const { b, credit, notes } = r.value;
      for (const { loan, note } of notes) if (note) { positions.push({ businessId: b.id, loan, note }); held.add(b.id); }
      if (credit > 0n) { credits.push({ businessId: b.id, amount: credit.toString() }); held.add(b.id); }
    }
  }
  const operated = businesses.filter((b) => b.operator === account).map((b) => b.id);
  const bids = businesses.filter((b) => b.current_loan?.status === "Foreclosed" && b.current_loan.auction.high_bidder === account).map((b) => b.id);
  const keep = new Set([...held, ...operated, ...bids]);
  return {
    businesses: businesses.filter((b) => keep.has(b.id)),
    positions,
    credits,
    operated,
    bids,
    checked,
    total: ordered.length,
    unread,
    at: Math.floor(Date.now() / 1000),
  };
}
