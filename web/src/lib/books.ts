// A business's books, computed only from what its contract's views return: get_agent,
// get_loans, get_jobs and the token's ft_balance_of, all read at one block. Pure functions,
// so the page, /api/books/[id] and the tests all compute the same figures the same way.
//
// What the chain does not record is left out rather than estimated: per-day vendor spend,
// lifetime owner's share (withdrawals are not counted) and what OutLayer charged per run.

import { centsUp, money, nearAmount, owedMoney, repaidMoney, toCents } from "./format";
import { ledgerTotal } from "./near/proof";
import type { Business, Job, LoanView } from "./near/types";

/** An amount in token base units, and the same amount as the app shows it (one rounding rule). */
export type Amount = { units: string; usd: string };
const amt = (units: bigint): Amount => ({ units: units.toString(), usd: money(units) });

export const WEEK_SECS = 7 * 86_400;
/** The contract keeps only the most recent 200 jobs (contracts/agent/src/jobs.rs KEEP_JOBS). */
export const KEPT_JOBS = 200;

/** The team's heartbeat buyer: a scheduled job buys one check from it every few hours. */
export const HEARTBEAT = "lien-f4-3863.testnet";

export type CustomerKind = "heartbeat" | "team" | "guest" | "outside";
export const KIND_LABEL: Record<CustomerKind, string> = {
  heartbeat: "Team heartbeat",
  team: "Team",
  guest: "Visitor (free guest account)",
  outside: "Outside account",
};

/**
 * Who a paying account is. Team: the heartbeat buyer, the role accounts lien-f1..f7, the
 * lender agent the team runs (lien-lender-*), lien-13569.testnet and its sub-accounts. The
 * free guest accounts made for visitors (*.guests.lien-13569.testnet and lien-guest-*) are
 * not team, and neither is any other account.
 */
export function customerKind(account: string): CustomerKind {
  if (account === HEARTBEAT) return "heartbeat";
  if (/\.guests\.lien-13569\.testnet$/.test(account) || /^lien-guest-[a-z\d-]+\.testnet$/.test(account)) return "guest";
  if (/^lien-f\d+-\d+\.testnet$/.test(account) || /^lien-lender-\d+\.testnet$/.test(account)) return "team";
  if (account === "lien-13569.testnet" || account.endsWith(".lien-13569.testnet")) return "team";
  return "outside";
}

export type BooksInput = {
  business: Business;
  /** Every job the contract still keeps, newest first (get_jobs, paged). */
  jobs: Job[];
  /** Every loan, newest first (get_loans, paged). */
  loans: LoanView[];
  /** ft_balance_of the business, in base units. */
  held: string;
  /** The block everything was read at, when known. */
  block?: { height: number; hash: string } | null;
};

type Period = {
  sales: Amount;
  salesCount: number;
  refunds: Amount;
  refundsCount: number;
  customers: number;
};

export type Customer = { account: string; kind: CustomerKind; sales: number; refunds: number; spent: Amount };
export type Sale = { job: number; payer: string; kind: CustomerKind; label: string; paid: Amount; status: Job["status"]; at: number; input: string };

export type LoanLine = {
  id: number;
  status: LoanView["status"];
  principal: Amount;
  totalDue: Amount;
  funded: Amount;
  /** Repaid to lenders, shown the way the business page shows it (adds up with outstanding). */
  repaid: Amount;
  outstanding: Amount;
  holders: number;
  lenderBps: number;
  operatorBps: number;
  createdAt: number;
  activatedAt: number | null;
  foreclosedAt: number | null;
  closedAt: number | null;
  auction: { highBidder: string | null; highBid: Amount };
};

export type Books = {
  id: string;
  name: string;
  operator: string;
  token: string;
  now: number;
  block: { height: number; hash: string } | null;
  income: {
    lifetime: {
      sales: Amount;
      salesCount: number;
      /** From job records; null when older jobs were dropped, so the amount is not knowable. */
      refunds: Amount | null;
      refundsCount: number;
      otherIncome: Amount;
      vendorPayments: Amount;
      spendsBlocked: number;
      /** Paid to lenders on every loan that ran: their share of sales, direct repayments, takeovers and sales. */
      lendersRepaid: Amount;
      ownerShareNow: Amount;
      runningMoneyNow: Amount;
    };
    last7: Period & { complete: boolean };
    /** Sales and refunds add up to the contract's own counters. */
    salesMatchCounter: boolean | null;
    compute: { depositPerRunNear: string; runs: number; tankNear: string };
  };
  balance: {
    held: Amount;
    owedToLenders: Amount;
    lenderPool: Amount;
    fundingEscrow: Amount;
    ownerShare: Amount;
    runningMoney: Amount;
    jobEscrow: Amount;
    auctionEscrow: Amount;
    credits: Amount;
    heldForOthers: Amount;
    ledgerTotal: Amount;
    /** "equal" is what npm run verify reports; "covers" means plain transfers it never recorded. */
    check: "equal" | "covers" | "short";
    difference: Amount;
    tankNear: string;
  };
  customers: {
    uniqueLifetime: number;
    /** Job records reach back to the first sale, so the breakdown covers every customer. */
    complete: boolean;
    recordsFrom: number | null;
    jobsInRecords: number;
    counted: number;
    matchesCounter: boolean | null;
    byKind: Record<CustomerKind, { accounts: number; sales: number; revenue: Amount }>;
    visitors: number;
    team: number;
    list: Customer[];
    recent: Sale[];
  };
  loans: {
    count: number;
    /** Loans that took lenders' money (not raising, not cancelled). */
    ran: number;
    borrowed: Amount;
    repaidToLenders: Amount;
    outstanding: Amount;
    repaidInFull: number;
    foreclosed: number;
    sold: number;
    cancelled: number;
    open: number;
    lines: LoanLine[];
  };
  policy: {
    price: Amount;
    vendors: string[];
    maxPerTx: Amount;
    maxPerDay: Amount;
    spentToday: Amount;
    spentLifetime: Amount;
    blocked: number;
    split: { lenderBps: number; operatorBps: number; keptBps: number; loanId: number } | null;
    loanOpen: boolean;
    wasmHash: string;
    computeDepositNear: string;
  };
};

const sum = (values: Iterable<bigint>) => { let s = 0n; for (const v of values) s += v; return s; };

/** Loans that took lenders' money and ran: a cancelled offer's refund is not a repayment. */
const ran = (loan: LoanView) => loan.status !== "Funding" && loan.status !== "Cancelled";

/** Sales and refunds among some jobs. */
function period(jobs: Job[]): Period {
  const done = jobs.filter((j) => j.status === "Done");
  const refunded = jobs.filter((j) => j.status === "Refunded");
  return {
    sales: amt(sum(done.map((j) => BigInt(j.paid)))),
    salesCount: done.length,
    refunds: amt(sum(refunded.map((j) => BigInt(j.paid)))),
    refundsCount: refunded.length,
    customers: new Set(jobs.map((j) => j.payer)).size,
  };
}

/** Every job from 0 to next_job_id - 1 is still on chain, so totals from records are complete. */
export const recordsComplete = (b: Business, jobs: Job[]) => {
  const ids = new Set(jobs.map((j) => j.id));
  for (let id = 0; id < b.next_job_id; id++) if (!ids.has(id)) return false;
  return true;
};

export function computeBooks({ business: b, jobs: rawJobs, loans: rawLoans, held: heldText, block = null }: BooksInput): Books {
  const jobs = [...rawJobs].sort((x, y) => y.id - x.id);
  const loans = [...rawLoans].sort((x, y) => y.id - x.id);
  const complete = recordsComplete(b, jobs);
  const now = b.now;

  // Income: lifetime from the contract's counters, refunds from records when they are all there.
  const all = period(jobs);
  const weekJobs = jobs.filter((j) => j.created_at > now - WEEK_SECS);
  const oldest = jobs.length ? jobs[jobs.length - 1]!.created_at : null;
  const last7 = { ...period(weekJobs), complete: complete || (oldest !== null && oldest <= now - WEEK_SECS) };
  const salesMatchCounter = complete ? all.sales.units === b.stats.job_revenue && all.salesCount === b.stats.jobs_done && all.refundsCount === b.stats.jobs_refunded : null;

  const lendersRepaid = sum(loans.filter(ran).map((l) => BigInt(l.repaid)));
  // Shown loan by loan the way the business page shows "Paid back" (repaidMoney), so that
  // what lenders got and what is still owed add up to each loan's rounded total, then summed.
  const repaidCents = sum(loans.filter(ran).map((l) => {
    const left = BigInt(l.terms.total_due) - BigInt(l.repaid);
    return toCents(l.terms.total_due) - centsUp(left > 0n ? left : 0n);
  }));
  const repaidAmount: Amount = { units: lendersRepaid.toString(), usd: money(repaidCents) };
  const l = b.ledger;
  const held = BigInt(heldText);
  const total = ledgerTotal(l);

  // Customers, from job records (every job counts its payer, as the contract's counter does).
  const byAccount = new Map<string, Customer & { units: bigint }>();
  for (const j of jobs) {
    const c = byAccount.get(j.payer) ?? { account: j.payer, kind: customerKind(j.payer), sales: 0, refunds: 0, spent: amt(0n), units: 0n };
    if (j.status === "Done") { c.sales++; c.units += BigInt(j.paid); }
    if (j.status === "Refunded") c.refunds++;
    byAccount.set(j.payer, c);
  }
  const list = [...byAccount.values()]
    .map(({ units, ...c }) => ({ ...c, spent: amt(units) }))
    .sort((x, y) => BigInt(y.spent.units) === BigInt(x.spent.units) ? y.sales - x.sales : BigInt(y.spent.units) > BigInt(x.spent.units) ? 1 : -1);
  const kinds: CustomerKind[] = ["heartbeat", "team", "guest", "outside"];
  const byKind = Object.fromEntries(kinds.map((k) => {
    const of = list.filter((c) => c.kind === k);
    return [k, { accounts: of.length, sales: of.reduce((n, c) => n + c.sales, 0), revenue: amt(sum(of.map((c) => BigInt(c.spent.units)))) }];
  })) as Books["customers"]["byKind"];

  const recent: Sale[] = jobs.filter((j) => j.status !== "Pending").slice(0, 8).map((j) => {
    const kind = customerKind(j.payer);
    return { job: j.id, payer: j.payer, kind, label: KIND_LABEL[kind], paid: amt(BigInt(j.paid)), status: j.status, at: j.created_at, input: j.input };
  });

  // Loans: the same rule as /api/market (lentAllTime, repaidAllTime) and the business page.
  const lines: LoanLine[] = loans.map((loan) => {
    const left = BigInt(loan.terms.total_due) - BigInt(loan.repaid);
    return {
      id: loan.id,
      status: loan.status,
      principal: amt(BigInt(loan.terms.principal)),
      totalDue: amt(BigInt(loan.terms.total_due)),
      funded: amt(BigInt(loan.funded)),
      repaid: { units: loan.repaid, usd: repaidMoney(loan.terms.total_due, loan.repaid) },
      outstanding: { units: (left > 0n ? left : 0n).toString(), usd: owedMoney(loan.terms.total_due, loan.repaid) },
      holders: loan.holders,
      lenderBps: loan.terms.lender_bps,
      operatorBps: loan.terms.operator_bps,
      createdAt: loan.created_at,
      activatedAt: loan.activated_at,
      foreclosedAt: loan.foreclosed_at,
      closedAt: loan.closed_at,
      auction: { highBidder: loan.auction.high_bidder, highBid: amt(BigInt(loan.auction.high_bid)) },
    };
  });
  const openLoans = loans.filter((x) => x.status === "Active" || x.status === "Foreclosed");
  const outstanding = sum(openLoans.map((x) => BigInt(x.terms.total_due) - BigInt(x.repaid)));

  const current = b.current_loan;
  const split = current && current.status !== "Cancelled"
    ? { lenderBps: current.terms.lender_bps, operatorBps: current.terms.operator_bps, keptBps: 10_000 - current.terms.lender_bps - current.terms.operator_bps, loanId: current.id }
    : null;
  const tankNear = nearAmount(b.tank, 3);
  const depositNear = nearAmount(b.service.compute_deposit, 3);

  return {
    id: b.id,
    name: b.name,
    operator: b.operator,
    token: b.token,
    now,
    block,
    income: {
      lifetime: {
        sales: amt(BigInt(b.stats.job_revenue)),
        salesCount: b.stats.jobs_done,
        refunds: complete ? all.refunds : null,
        refundsCount: b.stats.jobs_refunded,
        otherIncome: amt(BigInt(b.stats.external_revenue)),
        vendorPayments: amt(BigInt(b.stats.spent)),
        spendsBlocked: b.stats.spends_blocked,
        lendersRepaid: repaidAmount,
        ownerShareNow: amt(BigInt(l.operator)),
        runningMoneyNow: amt(BigInt(l.opex)),
      },
      last7,
      salesMatchCounter,
      compute: { depositPerRunNear: depositNear, runs: b.stats.jobs_done + b.stats.jobs_refunded + b.pending_jobs, tankNear },
    },
    balance: {
      held: amt(held),
      owedToLenders: amt(BigInt(l.lender_pool) + BigInt(l.funding_escrow)),
      lenderPool: amt(BigInt(l.lender_pool)),
      fundingEscrow: amt(BigInt(l.funding_escrow)),
      ownerShare: amt(BigInt(l.operator)),
      runningMoney: amt(BigInt(l.opex)),
      jobEscrow: amt(BigInt(l.job_escrow)),
      auctionEscrow: amt(BigInt(l.auction_escrow)),
      credits: amt(BigInt(l.credits)),
      heldForOthers: amt(BigInt(l.job_escrow) + BigInt(l.auction_escrow) + BigInt(l.credits)),
      ledgerTotal: amt(total),
      check: held === total ? "equal" : held > total ? "covers" : "short",
      difference: amt(held > total ? held - total : total - held),
      tankNear,
    },
    customers: {
      uniqueLifetime: b.stats.unique_payers,
      complete,
      recordsFrom: jobs.length ? jobs[jobs.length - 1]!.id : null,
      jobsInRecords: jobs.length,
      counted: byAccount.size,
      matchesCounter: complete ? byAccount.size === b.stats.unique_payers : null,
      byKind,
      visitors: byKind.guest.accounts + byKind.outside.accounts,
      team: byKind.heartbeat.accounts + byKind.team.accounts,
      list,
      recent,
    },
    loans: {
      count: loans.length,
      ran: loans.filter(ran).length,
      borrowed: amt(sum(loans.filter(ran).map((x) => BigInt(x.funded)))),
      repaidToLenders: repaidAmount,
      outstanding: { units: outstanding.toString(), usd: owedMoney(outstanding, 0n) },
      repaidInFull: loans.filter((x) => x.status === "Repaid").length,
      foreclosed: loans.filter((x) => x.foreclosed_at !== null).length,
      sold: loans.filter((x) => x.status === "Sold").length,
      cancelled: loans.filter((x) => x.status === "Cancelled").length,
      open: openLoans.length,
      lines,
    },
    policy: {
      price: amt(BigInt(b.service.price)),
      vendors: b.service.policy.vendors,
      maxPerTx: amt(BigInt(b.service.policy.max_per_tx)),
      maxPerDay: amt(BigInt(b.service.policy.max_per_day)),
      spentToday: amt(BigInt(b.spent_today)),
      spentLifetime: amt(BigInt(b.stats.spent)),
      blocked: b.stats.spends_blocked,
      split,
      loanOpen: current !== null && current.status !== "Cancelled",
      wasmHash: b.service.wasm.hash,
      computeDepositNear: depositNear,
    },
  };
}
