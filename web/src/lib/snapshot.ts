// What the market and the positions page show, read once on the server and shared by every
// visitor for a few seconds. A browser asking a dozen public RPC nodes for every business
// on every poll gets throttled (429s, CORS-blocked retries); one cached server read does not.
// Every figure still comes from the contracts' own views.

import { listBusinesses, getCredit, getJobs, getLoans, getNote, isTestRun } from "./near/rpc";
import type { Business, LoanView, NoteView } from "./near/types";
import { isTeamSample } from "./demo";
import { distinctName } from "./names";

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

function activityFor(b: Business, loans: LoanView[], jobs: Awaited<ReturnType<typeof getJobs>>, all: Business[]): Activity[] {
  const items: Activity[] = [];
  const base = { businessId: b.id, businessName: distinctName(b, all) };
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
    if (isFeatured(b)) activity.push(...activityFor(b, loans, jobs, businesses));
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
  /** Auctions this account won: the business it bought, and for how much. */
  bought: Array<{ businessId: string; price: string }>;
  checked: number;
  total: number;
  unread: number;
  /** Businesses that could not be read in time, so the page can say which. */
  unreadIds: string[];
  at: number;
};

const withTimeout = <T,>(work: Promise<T>, ms: number) =>
  Promise.race([work, new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), ms))]);

/**
 * Everything one account holds, across every business (test ones too, since a position can
 * sit anywhere). Read in batches within a time budget: a partial answer, with how far it got,
 * beats a page that waits forever.
 */
export async function readPositions(account: string, budgetMs = 14_000): Promise<PositionsSnapshot> {
  const started = Date.now();
  const businesses = await listBusinesses({ includeTests: true });
  // Real businesses first, test runs last: if time runs out, it is the test runs that wait.
  const ordered = [...businesses].sort((a, b) => Number(isTestRun(a.id)) - Number(isTestRun(b.id)));
  const positions: PositionJson[] = [];
  const credits: Array<{ businessId: string; amount: string }> = [];
  const bought: Array<{ businessId: string; price: string }> = [];
  const held = new Set<string>();
  const unreadIds: string[] = [];

  const readOne = async (b: Business) => {
    const [loans, credit] = await Promise.all([getLoans(b.id), getCredit(b.id, account)]);
    const notes = await Promise.all(loans.map(async (loan) => ({ loan, note: await getNote(b.id, loan.id, account) })));
    return { credit, notes, loans };
  };

  // A small pool instead of batches: one slow business never holds up the next five.
  let next = 0;
  const worker = async () => {
    while (next < ordered.length) {
      const b = ordered[next++]!;
      const left = budgetMs - (Date.now() - started);
      if (left < 500) { unreadIds.push(b.id); continue; }
      try {
        const { credit, notes, loans } = await withTimeout(readOne(b), Math.min(6_000, left));
        for (const { loan, note } of notes) if (note) { positions.push({ businessId: b.id, loan, note }); held.add(b.id); }
        if (credit > 0n) { credits.push({ businessId: b.id, amount: credit.toString() }); held.add(b.id); }
        for (const loan of loans) {
          if (loan.status === "Sold" && loan.auction.high_bidder === account) { bought.push({ businessId: b.id, price: loan.auction.high_bid }); held.add(b.id); }
        }
      } catch {
        unreadIds.push(b.id);
      }
    }
  };
  await Promise.all(Array.from({ length: 8 }, worker));

  const operated = businesses.filter((b) => b.operator === account).map((b) => b.id);
  const bids = businesses.filter((b) => b.current_loan?.status === "Foreclosed" && b.current_loan.auction.high_bidder === account).map((b) => b.id);
  const keep = new Set([...held, ...operated, ...bids]);
  return {
    businesses: businesses.filter((b) => keep.has(b.id)),
    positions,
    credits,
    operated,
    bids,
    bought,
    checked: ordered.length - unreadIds.length,
    total: ordered.length,
    unread: unreadIds.length,
    unreadIds,
    at: Math.floor(Date.now() / 1000),
  };
}
