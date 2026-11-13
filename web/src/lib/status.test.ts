import { describe, expect, it } from "vitest";
import { money, owedMoney } from "./format";
import { isTeamSample, sampleNote } from "./demo";
import { standing, STANDING_LABEL } from "./status";
import type { Business, LoanView } from "./near/types";

const loan = (over: Partial<LoanView>): LoanView => ({
  id: 0,
  terms: { principal: "40000000", total_due: "44000000", lender_bps: 3000, operator_bps: 2000, funding_secs: 1, term_secs: 100, window_secs: 10, min_payment_per_window: "1", grace_secs: 5, auction_secs: 30, auction_reserve_bps: 2000 },
  status: "Foreclosed",
  created_at: 0, funding_deadline: 0, activated_at: 1, funded: "40000000", repaid: "0", holders: 1, foreclosed_at: 50, closed_at: null,
  auction: { high_bidder: "a.testnet", high_bid: "7800000", ends_at: 100 },
  outstanding: "44000000", is_behind: true, breach_at: 20, foreclosable_at: 30, maturity: 101, min_next_bid: "8190000",
  ...over,
} as LoanView);

const biz = (l: LoanView | null, now: number): Business => ({ id: "x.v1.lien-13569.testnet", current_loan: l, now } as unknown as Business);

describe("one state per auction", () => {
  it("says the auction has ended once its clock runs out, and nothing else", () => {
    expect(standing(biz(loan({}), 99))).toBe("auction");
    expect(standing(biz(loan({}), 100))).toBe("sale-ended");
    expect(STANDING_LABEL["sale-ended"]).toMatch(/anyone can complete the sale/);
  });
  it("is still open for bids when nobody has bid", () => {
    expect(standing(biz(loan({ auction: { high_bidder: null, high_bid: "0", ends_at: null } }), 999))).toBe("foreclosed");
  });
});

describe("figures that add up", () => {
  it("shows still-owed as the rounded total minus the rounded repaid amount", () => {
    // 110.000000 due, 19.274999 repaid: rounded separately these would show 19.27 and 90.73.
    const total = "110000000";
    const repaid = "19275000";
    const owed = owedMoney(total, repaid);
    const toNumber = (m: string) => Number(m.replace(/[$,]/g, ""));
    expect(toNumber(owed) + toNumber(money(repaid))).toBeCloseTo(110, 2);
  });
});

describe("sample labels", () => {
  const id = "lookout-late-1.v1.lien-13569.testnet";
  it("names the team only while the team owns it", () => {
    expect(isTeamSample({ id, operator: "lien-f4-3863.testnet" })).toBe(true);
    expect(sampleNote({ id, operator: "lien-f4-3863.testnet" })).toMatch(/run by the Lien team/);
    expect(sampleNote({ id, operator: "buyer.testnet" })).toBe("Bought by buyer.testnet at auction");
    expect(sampleNote({ id: "other.v1.lien-13569.testnet", operator: "lien-f4-3863.testnet" })).toBeNull();
  });
});
