// The contract's money rules (contracts/agent/src/math.rs), ported so the app can
// preview them. The contract stays the authority; math.test.ts holds this to the
// same cases as the Rust tests.

export const BPS = 10_000n;

export type Split = { lender: bigint; operator: bigint; opex: bigint };

export function splitInflow(amount: bigint, outstanding: bigint, lenderBps: number, operatorBps: number, trapped: boolean): Split {
  const [lenderShare, operatorShare] = trapped
    ? [BigInt(lenderBps) + BigInt(operatorBps), 0n]
    : [BigInt(lenderBps), BigInt(operatorBps)];
  const wanted = (amount * lenderShare) / BPS;
  const lender = wanted < outstanding ? wanted : outstanding;
  const operator = (amount * operatorShare) / BPS;
  return { lender, operator, opex: amount - lender - operator };
}

export type Schedule = {
  activatedAt: number;
  termSecs: number;
  windowSecs: number;
  minPaymentPerWindow: bigint;
  totalDue: bigint;
};

export function breachTime(s: Schedule, repaid: bigint): number | null {
  if (repaid >= s.totalDue) return null;
  const maturity = s.activatedAt + s.termSecs;
  if (s.minPaymentPerWindow === 0n) return maturity;
  const covered = repaid / s.minPaymentPerWindow;
  const at = BigInt(s.activatedAt) + (covered + 1n) * BigInt(s.windowSecs);
  return at < BigInt(maturity) ? Number(at) : maturity;
}

export const isBehind = (s: Schedule, repaid: bigint, now: number) => {
  const at = breachTime(s, repaid);
  return at !== null && now >= at;
};

export const canForeclose = (s: Schedule, repaid: bigint, now: number, graceSecs: number) => {
  const at = breachTime(s, repaid);
  return at !== null && now >= at + graceSecs;
};

export function claimable(pool: bigint, note: bigint, funded: bigint, claimed: bigint): bigint {
  if (funded === 0n) return 0n;
  const earned = (pool * note) / funded;
  return earned > claimed ? earned - claimed : 0n;
}

export function minBid(outstanding: bigint, reserveBps: number, highBid: bigint): bigint {
  if (highBid === 0n) {
    const reserve = (outstanding * BigInt(reserveBps)) / BPS;
    return reserve > 1n ? reserve : 1n;
  }
  const step = highBid / 20n;
  return highBid + (step > 1n ? step : 1n);
}

/** What a borrower's terms mean if revenue is steady. Used by the offer builder. */
export function projectPayoff(input: {
  totalDue: bigint;
  lenderBps: number;
  revenuePerWindow: bigint;
  windowSecs: number;
  minPaymentPerWindow: bigint;
  termSecs: number;
}) {
  const perWindow = (input.revenuePerWindow * BigInt(input.lenderBps)) / BPS;
  const meetsMinimum = perWindow >= input.minPaymentPerWindow;
  const windows = perWindow > 0n ? Number((input.totalDue + perWindow - 1n) / perWindow) : null;
  const payoffSecs = windows === null ? null : windows * input.windowSecs;
  return {
    perWindow,
    meetsMinimum,
    payoffSecs,
    paysBeforeMaturity: payoffSecs !== null && payoffSecs <= input.termSecs,
  };
}
