// What the market and the positions page show, read once on the server and shared by every
// visitor for a few seconds. A browser asking a dozen public RPC nodes for every business
// on every poll gets throttled (429s, CORS-blocked retries); one cached server read does not.
// Every figure still comes from the contracts' own views.

import { listBusinesses, listBusinessIds, getBusiness, getCredit, getJobs, getLoans, getNote, isTestRun } from "./near/rpc";
import type { Business, LoanView, NoteView } from "./near/types";
import { isGuestOwned, isStagedLoan, isTeamRun, isTeamSample, looksLikeProbe } from "./demo";
import { distinctName } from "./names";

export type Activity = { at: number; businessId: string; businessName: string; text: string; key: string };

/** Lifetime figures across every listed business. Amounts are base-unit strings. */
export type MarketStats = {
  /** Every business listed on the market: featured, the team's test businesses and visitors' together. */
  businesses: number;
  lentNow: string;
  lentAllTime: string;
  repaidAllTime: string;
  /** Loans on a real clock (payments due every few days or weeks) that were repaid in full. */
  loansRepaid: number;
  /** Loans on a real clock whose business missed payments and was taken over. */
  loansTakenOver: number;
  /** Repaid to lenders on real-clock loans that have closed, against what those loans owed. */
  closedRecovered: string;
  closedDue: string;
  /**
   * Staged demonstrations, counted apart: loans whose payments fall due every few minutes
   * (lib/demo.ts isStagedLoan), opened by the team so visitors can take over and bid. They fall
   * behind on purpose, so counting them with real loans would read as a default rate.
   */
  staged: StagedStats;
  checksSold: number;
};

export type StagedStats = { loans: number; repaid: number; takenOver: number; closedRecovered: string; closedDue: string; longestWindowSecs: number | null };

export type MarketSnapshot = { businesses: Business[]; stats: MarketStats; activity: Activity[]; at: number };

import { money, repaidMoney } from "./format";

function activityFor(b: Business, loans: LoanView[], jobs: Awaited<ReturnType<typeof getJobs>>, all: Business[]): Activity[] {
  const items: Activity[] = [];
  const base = { businessId: b.id, businessName: distinctName(b, all) };
  for (const job of jobs.slice(0, 4)) {
    const at = Number(job.created_at);
    if (job.status === "Done") items.push({ ...base, at, key: `${b.id}:job:${job.id}`, text: saleText(money(job.paid), loans, at) });
    else if (job.status === "Refunded") items.push({ ...base, at, key: `${b.id}:job:${job.id}`, text: `refunded a check that couldn't finish (${money(job.paid)} back to the buyer)` });
  }
  for (const loan of loans.slice(0, 3)) {
    const size = money(loan.terms.principal);
    items.push({ ...base, at: loan.created_at, key: `${b.id}:loan:${loan.id}:offer`, text: `asked lenders for a ${size} loan` });
    if (loan.activated_at) items.push({ ...base, at: loan.activated_at, key: `${b.id}:loan:${loan.id}:active`, text: `raised its ${size} loan in full` });
    if (loan.foreclosed_at) items.push({ ...base, at: loan.foreclosed_at, key: `${b.id}:loan:${loan.id}:taken`, text: isStagedLoan(loan) ? "was taken over for its lenders, as staged: a demo loan on a minutes-long clock" : "was taken over for its lenders after missing payments" });
    if (loan.closed_at && loan.status === "Repaid") items.push({ ...base, at: loan.closed_at, key: `${b.id}:loan:${loan.id}:repaid`, text: `paid back its ${size} loan in full` });
    if (loan.closed_at && loan.status === "Sold") items.push({ ...base, at: loan.closed_at, key: `${b.id}:loan:${loan.id}:sold`, text: `was sold at auction; lenders recovered ${repaidMoney(loan.terms.total_due, loan.repaid)} of ${money(loan.terms.total_due)}` });
  }
  return items;
}

/**
 * What a sale did, in words that fit the business's state when it was made. Lenders are paid
 * from a sale only while a loan is running or taken over; with no loan, the sale is just a sale.
 */
export function saleText(price: string, loans: LoanView[], at: number): string {
  const loan = loans.find((l) => l.activated_at !== null && l.activated_at <= at && (l.closed_at === null || l.closed_at >= at));
  if (!loan) return `sold a safety check for ${price}`;
  if (loan.foreclosed_at !== null && loan.foreclosed_at <= at) return `sold a safety check for ${price}; it was taken over, so its lenders got the owner's share too`;
  return `sold a safety check for ${price}, and its lenders were paid their share`;
}

/**
 * Where a business is listed on the market, one rule for every page and every count:
 * - featured: the team's own businesses (the samples, Harbor, Courier, Relay...) and any business
 *   three or more different customers use;
 * - team: businesses the team runs to test the product (probes, the prompt-injection demo);
 * - visitors: everything else, mostly started or bought with free test accounts.
 */
export type MarketGroup = "featured" | "team" | "visitors";
export function marketGroup(b: Business): MarketGroup {
  const probe = looksLikeProbe(b);
  if (isTeamRun(b) || isTeamSample(b)) return probe ? "team" : "featured";
  if (b.stats.unique_payers >= 3 && !isGuestOwned(b) && !probe) return "featured";
  return "visitors";
}

export const isFeatured = (b: Business) => marketGroup(b) === "featured";

export async function readMarket(): Promise<MarketSnapshot> {
  const businesses = await listBusinesses();
  const per = await Promise.allSettled(
    businesses.map(async (b) => {
      const [loans, jobs] = await Promise.all([getLoans(b.id, 50), isFeatured(b) ? getJobs(b.id, 4) : Promise.resolve([])]);
      return { b, loans, jobs };
    }),
  );
  const activity: Activity[] = [];
  const loans: LoanView[] = [];
  for (const r of per) {
    if (r.status !== "fulfilled") continue;
    loans.push(...r.value.loans);
    if (isFeatured(r.value.b)) activity.push(...activityFor(r.value.b, r.value.loans, r.value.jobs, businesses));
  }
  return {
    businesses,
    stats: { ...loanStats(loans), businesses: businesses.length, checksSold: businesses.reduce((sum, b) => sum + b.stats.jobs_done, 0) },
    activity: activity.sort((a, b) => b.at - a.at).slice(0, 8),
    at: Math.floor(Date.now() / 1000),
  };
}

/** The market's loan figures, with staged demo loans counted apart. Pure, so it is tested. */
export function loanStats(loans: LoanView[]): Omit<MarketStats, "businesses" | "checksSold"> {
  let lentNow = 0n, lentAllTime = 0n, repaidAllTime = 0n, closedRecovered = 0n, closedDue = 0n, stagedRecovered = 0n, stagedDue = 0n;
  let loansRepaid = 0, loansTakenOver = 0, stagedLoans = 0, stagedRepaid = 0, stagedTakenOver = 0;
  let longest: number | null = null;
  for (const loan of loans) {
    if (loan.status === "Funding" || loan.status === "Cancelled") continue;
    lentAllTime += BigInt(loan.funded);
    repaidAllTime += BigInt(loan.repaid);
    if (loan.status === "Active" || loan.status === "Foreclosed") lentNow += BigInt(loan.funded);
    const closed = loan.status === "Repaid" || loan.status === "Sold";
    if (isStagedLoan(loan)) {
      stagedLoans++;
      longest = Math.max(longest ?? 0, loan.terms.window_secs);
      if (loan.status === "Repaid") stagedRepaid++;
      if (loan.foreclosed_at) stagedTakenOver++;
      if (closed) { stagedRecovered += BigInt(loan.repaid); stagedDue += BigInt(loan.terms.total_due); }
      continue;
    }
    if (loan.status === "Repaid") loansRepaid++;
    if (loan.foreclosed_at) loansTakenOver++;
    if (closed) { closedRecovered += BigInt(loan.repaid); closedDue += BigInt(loan.terms.total_due); }
  }
  return {
    lentNow: lentNow.toString(),
    lentAllTime: lentAllTime.toString(),
    repaidAllTime: repaidAllTime.toString(),
    loansRepaid,
    loansTakenOver,
    closedRecovered: closedRecovered.toString(),
    closedDue: closedDue.toString(),
    staged: { loans: stagedLoans, repaid: stagedRepaid, takenOver: stagedTakenOver, closedRecovered: stagedRecovered.toString(), closedDue: stagedDue.toString(), longestWindowSecs: longest },
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
  /** Display names, told apart against the whole market (lib/names.ts), so twins read the same everywhere. */
  names?: Record<string, string>;
  /** Businesses whose loans, notes and credit were read (fresh, or from the last good read). */
  readIds: string[];
  checked: number;
  total: number;
  unread: number;
  /** Businesses that could not be read in time, so the page can say which and keep what it had. */
  unreadIds: string[];
  at: number;
};

/** Settles within `ms` or rejects, so one slow node never holds up the whole page. */
export const within = <T,>(work: Promise<T>, ms: number) => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    work,
    new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("timeout")), ms); }),
  ]).finally(() => clearTimeout(timer));
};

/** Runs `task` over `items` with at most `limit` at once. */
export async function pool<T>(items: T[], limit: number, task: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < items.length) await task(items[next++]!);
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

type Holding = {
  notes: Array<{ loan: LoanView; note: NoteView }>;
  credit: bigint;
  bought: Array<{ price: string }>;
};

/** The last good read of each business for each account, so a slow node never erases a row. */
const lastGood = new Map<string, Map<string, Holding>>();

/** What a business holds for an account. A business that never borrowed has no notes to read. */
async function readHolding(b: Business, account: string): Promise<Holding> {
  if (b.loan_count === 0) return { notes: [], credit: await getCredit(b.id, account), bought: [] };
  const [loans, credit] = await Promise.all([getLoans(b.id), getCredit(b.id, account)]);
  // An offer cancelled before anyone lent holds no notes.
  const lendable = loans.filter((loan) => !(loan.status === "Cancelled" && loan.funded === "0"));
  const notes = await Promise.all(lendable.map(async (loan) => ({ loan, note: await getNote(b.id, loan.id, account) })));
  return {
    notes: notes.flatMap(({ loan, note }) => (note ? [{ loan, note }] : [])),
    credit,
    bought: loans.flatMap((loan) => (loan.status === "Sold" && loan.auction.high_bidder === account ? [{ price: loan.auction.high_bid }] : [])),
  };
}

/**
 * Everything one account holds, read once on the server with a small pool of workers.
 * Automated test runs are skipped unless the account owns one or the browser says it dealt
 * with one (`also`). A business that cannot be read in time keeps its last good answer; only
 * one never read counts as unread, and it is read first on the next request (`first`).
 */
export async function readPositions(account: string, { first = [], also = [] }: { first?: string[]; also?: string[] } = {}, budgetMs = 14_000): Promise<PositionsSnapshot> {
  const started = Date.now();
  const ids = await within(listBusinessIds(), 8_000);
  const listed = await Promise.allSettled(ids.map((id) => within(getBusiness(id), 8_000)));
  const businesses = listed.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
  const unreadIds = ids.filter((_, i) => listed[i]!.status !== "fulfilled");
  const extra = new Set(also);
  const scanned = businesses.filter((b) => !isTestRun(b.id) || b.operator === account || extra.has(b.id));

  const memory = lastGood.get(account) ?? new Map<string, Holding>();
  // Most recently asked last, and only so many accounts kept: the oldest is forgotten first.
  lastGood.delete(account);
  lastGood.set(account, memory);
  if (lastGood.size > 500) lastGood.delete(lastGood.keys().next().value!);
  // Never read before, or asked for first: those go to the front of the queue.
  const urgent = new Set(first);
  const rank = (b: Business) => (urgent.has(b.id) || !memory.has(b.id) ? 0 : 1);
  const ordered = [...scanned].sort((a, b) => rank(a) - rank(b));

  await pool(ordered, 6, async (b) => {
    const left = budgetMs - (Date.now() - started);
    if (left < 500) return;
    try {
      memory.set(b.id, await within(readHolding(b, account), Math.min(8_000, left)));
    } catch {
      /* the last good read, if any, stands */
    }
  });

  const positions: PositionJson[] = [];
  const credits: Array<{ businessId: string; amount: string }> = [];
  const bought: Array<{ businessId: string; price: string }> = [];
  const held = new Set<string>();
  const readIds: string[] = [];
  for (const b of scanned) {
    const holding = memory.get(b.id);
    if (!holding) { unreadIds.push(b.id); continue; }
    readIds.push(b.id);
    for (const { loan, note } of holding.notes) { positions.push({ businessId: b.id, loan, note }); held.add(b.id); }
    if (holding.credit > 0n) { credits.push({ businessId: b.id, amount: holding.credit.toString() }); held.add(b.id); }
    for (const { price } of holding.bought) { bought.push({ businessId: b.id, price }); held.add(b.id); }
  }

  const operated = businesses.filter((b) => b.operator === account).map((b) => b.id);
  const bids = businesses.filter((b) => b.current_loan?.status === "Foreclosed" && b.current_loan.auction.high_bidder === account).map((b) => b.id);
  const keep = new Set([...held, ...operated, ...bids]);
  const market = businesses.filter((b) => !isTestRun(b.id));
  const kept = businesses.filter((b) => keep.has(b.id));
  const total = scanned.length + (ids.length - businesses.length);
  return {
    businesses: kept,
    names: Object.fromEntries(kept.map((b) => [b.id, distinctName(b, market)])),
    positions,
    credits,
    operated,
    bids,
    bought,
    readIds,
    checked: readIds.length,
    total,
    unread: unreadIds.length,
    unreadIds,
    at: Math.floor(Date.now() / 1000),
  };
}
