import { describe, expect, it } from "vitest";
import { computeBooks, customerKind, recordsComplete, WEEK_SECS } from "./books";
import type { Business, Job, LoanView } from "./near/types";

const NOW = 1_794_647_849;
const D = 1_000_000n; // one dollar in base units (6 decimals)

function business(over: Partial<Business> = {}): Business {
  return {
    id: "shop.v1.lien-13569.testnet",
    name: "Shop",
    description: "",
    source_url: "",
    registry: "v1.lien-13569.testnet",
    token: "usd.lien-13569.testnet",
    outlayer: "outlayer.testnet",
    collector: "shop-in.v1.lien-13569.testnet",
    operator: "lien-f1-3833.testnet",
    service: {
      wasm: { url: "https://x", hash: "a".repeat(64), build_target: "wasm32-wasip1" },
      price: "250000",
      max_instructions: 1,
      max_memory_mb: 1,
      max_execution_seconds: 1,
      compute_deposit: "20000000000000000000000",
      secrets_profile: null,
      policy: { vendors: ["lien-f6-3876.testnet"], max_per_tx: "100000", max_per_day: "5000000" },
    },
    ledger: { opex: "102940000", operator: "1400000", lender_pool: "20210000", funding_escrow: "0", job_escrow: "0", auction_escrow: "0", credits: "0" },
    stats: { jobs_done: 3, jobs_refunded: 1, unique_payers: 3, job_revenue: "750000", external_revenue: "0", spent: "560000", spends_blocked: 0 },
    tank: "711706899999999999999963",
    loan_count: 1,
    current_loan: null,
    proposal: null,
    next_job_id: 4,
    pending_jobs: 0,
    spent_today: "80000",
    now: NOW,
    ...over,
  };
}

const job = (id: number, payer: string, status: Job["status"], ageSecs: number, paid = "250000"): Job => ({
  id, payer, paid, input: `check ${id}`, status, report: null, created_at: NOW - ageSecs, wasm_hash: "a".repeat(64),
});

function loan(id: number, status: LoanView["status"], principal: bigint, totalDue: bigint, repaid: bigint, over: Partial<LoanView> = {}): LoanView {
  return {
    id,
    terms: { principal: principal.toString(), total_due: totalDue.toString(), lender_bps: 3000, operator_bps: 2000, funding_secs: 1, term_secs: 1, window_secs: 1, min_payment_per_window: "1", grace_secs: 1, auction_secs: 1, auction_reserve_bps: 5000 },
    status,
    created_at: NOW - 1000,
    funding_deadline: NOW,
    activated_at: status === "Funding" || status === "Cancelled" ? null : NOW - 900,
    funded: status === "Funding" ? "0" : principal.toString(),
    repaid: repaid.toString(),
    holders: 2,
    foreclosed_at: null,
    closed_at: null,
    auction: { high_bidder: null, high_bid: "0", ends_at: null },
    outstanding: (totalDue - repaid).toString(),
    is_behind: false,
    breach_at: null,
    foreclosable_at: null,
    maturity: null,
    min_next_bid: null,
    ...over,
  };
}

const JOBS = [
  job(3, "lien-f4-3863.testnet", "Done", 60),
  job(2, "g1abc.guests.lien-13569.testnet", "Refunded", 3_600),
  job(1, "alice.testnet", "Done", 2 * 86_400),
  job(0, "lien-f4-3863.testnet", "Done", 9 * 86_400),
];
const ACTIVE = loan(0, "Active", 100n * D, 110n * D, 20_210_000n);
const HELD = "124550000";

describe("who a customer is", () => {
  it("names the heartbeat, the team, guests and everyone else", () => {
    expect(customerKind("lien-f4-3863.testnet")).toBe("heartbeat");
    expect(customerKind("lien-f1-3833.testnet")).toBe("team");
    expect(customerKind("lien-f7-4000.testnet")).toBe("team");
    expect(customerKind("lien-13569.testnet")).toBe("team");
    expect(customerKind("sentinel.v1.lien-13569.testnet")).toBe("team");
    expect(customerKind("lien-lender-645368.testnet")).toBe("team");
    expect(customerKind("g1nalyu7.guests.lien-13569.testnet")).toBe("guest");
    expect(customerKind("lien-guest-ab12.testnet")).toBe("guest");
    expect(customerKind("alice.testnet")).toBe("outside");
    expect(customerKind("lien-13569.testnet.evil.testnet")).toBe("outside");
  });
});

describe("income statement", () => {
  it("takes lifetime sales from the contract's counters and refunds from complete job records", () => {
    const books = computeBooks({ business: business(), jobs: JOBS, loans: [ACTIVE], held: HELD });
    const life = books.income.lifetime;
    expect(life.sales).toEqual({ units: "750000", usd: "$0.75" });
    expect(life.salesCount).toBe(3);
    expect(life.refunds).toEqual({ units: "250000", usd: "$0.25" });
    expect(life.refundsCount).toBe(1);
    expect(life.vendorPayments.usd).toBe("$0.56");
    expect(life.lendersRepaid.usd).toBe("$20.21");
    expect(life.ownerShareNow.usd).toBe("$1.40");
    expect(life.runningMoneyNow.usd).toBe("$102.94");
    expect(books.income.salesMatchCounter).toBe(true);
  });

  it("counts only the last seven days in the week column", () => {
    const week = computeBooks({ business: business(), jobs: JOBS, loans: [], held: HELD }).income.last7;
    expect(week.salesCount).toBe(2);
    expect(week.sales.usd).toBe("$0.50");
    expect(week.refundsCount).toBe(1);
    expect(week.customers).toBe(3);
    expect(week.complete).toBe(true);
  });

  it("leaves refunds unknown when older jobs were dropped, but keeps a week that the records still cover", () => {
    const b = business({ next_job_id: 250, stats: { ...business().stats, jobs_done: 240 } });
    const kept = Array.from({ length: 200 }, (_, i) => job(249 - i, "alice.testnet", "Done", i * 3_600));
    const books = computeBooks({ business: b, jobs: kept, loans: [], held: HELD });
    expect(recordsComplete(b, kept)).toBe(false);
    expect(books.income.lifetime.refunds).toBeNull();
    expect(books.income.salesMatchCounter).toBeNull();
    expect(books.income.last7.complete).toBe(true);
    expect(books.income.last7.salesCount).toBe(WEEK_SECS / 3_600);
    expect(books.customers.complete).toBe(false);
    expect(books.customers.matchesCounter).toBeNull();
  });

  it("says when even the week is not covered", () => {
    const b = business({ next_job_id: 300 });
    const kept = Array.from({ length: 200 }, (_, i) => job(299 - i, "alice.testnet", "Done", i * 60));
    expect(computeBooks({ business: b, jobs: kept, loans: [], held: HELD }).income.last7.complete).toBe(false);
  });
});

describe("balance sheet", () => {
  it("groups the ledger and finds it equal to the tokens held", () => {
    const bal = computeBooks({ business: business(), jobs: JOBS, loans: [ACTIVE], held: HELD }).balance;
    expect(bal.held.usd).toBe("$124.55");
    expect(bal.owedToLenders.usd).toBe("$20.21");
    expect(bal.ledgerTotal.units).toBe(HELD);
    expect(bal.check).toBe("equal");
    expect(bal.tankNear).toBe("0.711");
  });

  it("adds funding escrow to what lenders are owed and escrows to what is held for others", () => {
    const b = business({ ledger: { opex: "0", operator: "0", lender_pool: "1000000", funding_escrow: "2000000", job_escrow: "250000", auction_escrow: "5000000", credits: "10000" } });
    const bal = computeBooks({ business: b, jobs: [], loans: [], held: "8260000" }).balance;
    expect(bal.owedToLenders.units).toBe("3000000");
    expect(bal.heldForOthers.units).toBe("5260000");
    expect(bal.check).toBe("equal");
  });

  it("reports untracked transfers and a shortfall plainly", () => {
    expect(computeBooks({ business: business(), jobs: [], loans: [], held: "124560000" }).balance).toMatchObject({ check: "covers", difference: { usd: "$0.01" } });
    expect(computeBooks({ business: business(), jobs: [], loans: [], held: "124000000" }).balance).toMatchObject({ check: "short", difference: { usd: "$0.55" } });
  });
});

describe("customers", () => {
  it("splits outside visitors from the team, and matches the contract's count", () => {
    const c = computeBooks({ business: business(), jobs: JOBS, loans: [], held: HELD }).customers;
    expect(c.complete).toBe(true);
    expect(c.counted).toBe(3);
    expect(c.matchesCounter).toBe(true);
    expect(c.visitors).toBe(2);
    expect(c.team).toBe(1);
    expect(c.byKind.heartbeat).toEqual({ accounts: 1, sales: 2, revenue: { units: "500000", usd: "$0.50" } });
    expect(c.byKind.guest).toEqual({ accounts: 1, sales: 0, revenue: { units: "0", usd: "$0.00" } });
    expect(c.byKind.outside.sales).toBe(1);
  });

  it("lists recent finished sales newest first, labelled, never a running one", () => {
    const jobs = [job(4, "bob.testnet", "Pending", 5), ...JOBS];
    const recent = computeBooks({ business: business({ next_job_id: 5 }), jobs: [...jobs].reverse(), loans: [], held: HELD }).customers.recent;
    expect(recent.map((s) => s.job)).toEqual([3, 2, 1, 0]);
    expect(recent[0]).toMatchObject({ payer: "lien-f4-3863.testnet", label: "Team heartbeat", paid: { usd: "$0.25" } });
    expect(recent[1]!.status).toBe("Refunded");
  });
});

describe("loans", () => {
  it("counts what lenders got the way the market does, leaving out cancelled offers", () => {
    const loans = [
      loan(3, "Active", 100n * D, 110n * D, 20_210_000n),
      loan(2, "Cancelled", 50n * D, 55n * D, 7n * D, { funded: (7n * D).toString() }),
      loan(1, "Sold", 20n * D, 22n * D, 15_333_333n, { foreclosed_at: NOW - 500, closed_at: NOW - 100 }),
      loan(0, "Repaid", 20n * D, 22n * D, 22n * D, { closed_at: NOW - 800 }),
    ];
    const l = computeBooks({ business: business(), jobs: [], loans, held: HELD }).loans;
    expect(l.count).toBe(4);
    expect(l.ran).toBe(3);
    expect(l.borrowed.usd).toBe("$140.00");
    expect(l.repaidToLenders.units).toBe((20_210_000n + 15_333_333n + 22n * D).toString());
    expect(l.outstanding).toEqual({ units: "89790000", usd: "$89.79" });
    expect(l.repaidInFull).toBe(1);
    expect(l.foreclosed).toBe(1);
    expect(l.sold).toBe(1);
    expect(l.cancelled).toBe(1);
    expect(l.open).toBe(1);
    // The business page's rule: repaid and still owed add up to the rounded total.
    expect(l.lines.find((x) => x.id === 1)!.repaid.usd).toBe("$15.33");
    expect(l.lines.find((x) => x.id === 1)!.outstanding.usd).toBe("$6.67");
  });
});

describe("half a cent", () => {
  it("shows what lenders got as the business page does, so it and what is owed add up", () => {
    const active = loan(0, "Active", 100n * D, 110n * D, 20_285_000n);
    const l = computeBooks({ business: business({ current_loan: active }), jobs: [], loans: [active], held: HELD });
    expect(l.loans.repaidToLenders).toEqual({ units: "20285000", usd: "$20.28" });
    expect(l.income.lifetime.lendersRepaid.usd).toBe("$20.28");
    expect(l.loans.lines[0]!.repaid.usd).toBe("$20.28");
    expect(l.loans.outstanding.usd).toBe("$89.72");
  });
});

describe("policy", () => {
  it("shows the split of the open loan, or none without one", () => {
    expect(computeBooks({ business: business(), jobs: [], loans: [], held: HELD }).policy).toMatchObject({ split: null, loanOpen: false, maxPerDay: { usd: "$5.00" } });
    const open = computeBooks({ business: business({ current_loan: ACTIVE }), jobs: [], loans: [ACTIVE], held: HELD }).policy;
    expect(open.split).toEqual({ lenderBps: 3000, operatorBps: 2000, keptBps: 5000, loanId: 0 });
    expect(open.loanOpen).toBe(true);
    expect(open.vendors).toEqual(["lien-f6-3876.testnet"]);
  });
});
