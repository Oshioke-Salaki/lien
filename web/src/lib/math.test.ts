import { describe, expect, it } from "vitest";
import { breachTime, canForeclose, claimable, isBehind, minBid, projectPayoff, splitInflow, type Schedule } from "./math";

// Same cases as contracts/agent/src/math.rs, so a drift between them fails here.
const schedule = (minPayment: bigint): Schedule => ({
  activatedAt: 1_000,
  termSecs: 1_000,
  windowSecs: 100,
  minPaymentPerWindow: minPayment,
  totalDue: 1_000n,
});

describe("splitInflow", () => {
  it("gives each party its share", () => {
    expect(splitInflow(1_000n, 10_000n, 3_000, 2_000, false)).toEqual({ lender: 300n, operator: 200n, opex: 500n });
  });
  it("stops the lender share at the debt", () => {
    expect(splitInflow(1_000n, 50n, 3_000, 2_000, false)).toEqual({ lender: 50n, operator: 200n, opex: 750n });
  });
  it("redirects the operator share when trapped", () => {
    expect(splitInflow(1_000n, 10_000n, 3_000, 2_000, true)).toEqual({ lender: 500n, operator: 0n, opex: 500n });
  });
  it("conserves every unit", () => {
    for (const amount of [0n, 1n, 7n, 999n, 123_456_789n]) {
      for (const [l, o] of [[3_333, 3_333], [1, 9_999], [10_000, 0]] as const) {
        for (const trapped of [true, false]) {
          const s = splitInflow(amount, 1_000n, l, o, trapped);
          expect(s.lender + s.operator + s.opex).toBe(amount);
        }
      }
    }
  });
});

describe("breachTime", () => {
  it("starts at the first uncovered window", () => {
    const s = schedule(100n);
    expect(breachTime(s, 0n)).toBe(1_100);
    expect(breachTime(s, 99n)).toBe(1_100);
    expect(breachTime(s, 100n)).toBe(1_200);
    expect(breachTime(s, 350n)).toBe(1_400);
  });
  it("treats maturity as a hard stop", () => expect(breachTime(schedule(100n), 999n)).toBe(2_000));
  it("never breaches a paid loan", () => {
    expect(breachTime(schedule(100n), 1_000n)).toBeNull();
    expect(isBehind(schedule(100n), 1_000n, 1e12)).toBe(false);
  });
  it("uses only maturity without a minimum", () => {
    expect(breachTime(schedule(0n), 0n)).toBe(2_000);
    expect(isBehind(schedule(0n), 0n, 1_999)).toBe(false);
    expect(isBehind(schedule(0n), 0n, 2_000)).toBe(true);
  });
  it("waits for grace", () => {
    expect(canForeclose(schedule(100n), 0n, 1_149, 50)).toBe(false);
    expect(canForeclose(schedule(100n), 0n, 1_150, 50)).toBe(true);
  });
  it("is cured by a payment", () => {
    expect(canForeclose(schedule(100n), 0n, 1_500, 50)).toBe(true);
    expect(isBehind(schedule(100n), 500n, 1_500)).toBe(false);
  });
});

describe("claimable", () => {
  it("handles an unfunded loan", () => expect(claimable(100n, 10n, 0n, 0n)).toBe(0n));
  it("never underflows", () => {
    expect(claimable(100n, 50n, 100n, 50n)).toBe(0n);
    expect(claimable(100n, 50n, 100n, 60n)).toBe(0n);
  });
});

describe("minBid", () => {
  it("uses the reserve first, then 5% steps", () => {
    expect(minBid(1_000n, 5_000, 0n)).toBe(500n);
    expect(minBid(1_000n, 0, 0n)).toBe(1n);
    expect(minBid(1_000n, 5_000, 600n)).toBe(630n);
    expect(minBid(1_000n, 5_000, 1n)).toBe(2n);
  });
});

describe("projectPayoff", () => {
  it("says when steady revenue repays the debt", () => {
    const p = projectPayoff({ totalDue: 1_000n, lenderBps: 2_500, revenuePerWindow: 1_000n, windowSecs: 100, minPaymentPerWindow: 200n, termSecs: 1_000 });
    expect(p.perWindow).toBe(250n);
    expect(p.meetsMinimum).toBe(true);
    expect(p.payoffSecs).toBe(400);
    expect(p.paysBeforeMaturity).toBe(true);
  });
  it("flags terms that cannot be met", () => {
    const p = projectPayoff({ totalDue: 1_000n, lenderBps: 100, revenuePerWindow: 1_000n, windowSecs: 100, minPaymentPerWindow: 200n, termSecs: 1_000 });
    expect(p.meetsMinimum).toBe(false);
    expect(p.paysBeforeMaturity).toBe(false);
  });
  it("handles zero revenue", () => {
    const p = projectPayoff({ totalDue: 1_000n, lenderBps: 100, revenuePerWindow: 0n, windowSecs: 100, minPaymentPerWindow: 0n, termSecs: 1_000 });
    expect(p.payoffSecs).toBeNull();
    expect(p.paysBeforeMaturity).toBe(false);
  });
});
