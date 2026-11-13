import { describe, expect, it } from "vitest";
import { minimumWarning, validateTerms } from "../../lib/terms";

const DAY = 86_400;
const terms = { principal: "100000000", total_due: "110000000", lender_bps: 3000, operator_bps: 2000, funding_secs: 7 * DAY, term_secs: 90 * DAY, window_secs: 14 * DAY, min_payment_per_window: "5000000", grace_secs: 3 * DAY, auction_secs: 7 * DAY, auction_reserve_bps: 5000 };

describe("the borrow form's own defaults", () => {
  it("passes its checks, and warns plainly when minimums alone won't clear the debt", () => {
    expect(validateTerms(terms)).toBeNull();
    expect(minimumWarning(terms)).toMatch(/minimum payments alone \(\$30\.00 over 90 days\) won't clear the \$110\.00 debt/);
  });
  it("says nothing when the minimums do clear it", () => {
    expect(minimumWarning({ ...terms, min_payment_per_window: "20000000" })).toBeNull();
  });
});
