import { describe, expect, it } from "vitest";
import { isStagedLoan, isTeamAccount } from "./demo";
import { distinctName } from "./names";
import { explainFlag } from "./report";
import { loanStats, marketGroup, saleText } from "./snapshot";
import type { Business, LoanView } from "./near/types";

const R = "v1.lien-13569.testnet";
const DAY = 86_400;

const loan = (over: Partial<LoanView> & { window?: number }): LoanView => {
  const { window = 14 * DAY, ...rest } = over;
  return {
    id: 0,
    terms: { principal: "40000000", total_due: "44000000", lender_bps: 3000, operator_bps: 2000, funding_secs: DAY, term_secs: 30 * DAY, window_secs: window, min_payment_per_window: "5000000", grace_secs: 300, auction_secs: 1800, auction_reserve_bps: 10000 },
    status: "Active", created_at: 0, funding_deadline: 0, activated_at: 100, funded: "40000000", repaid: "0", holders: 1,
    foreclosed_at: null, closed_at: null, auction: { high_bidder: null, high_bid: "0", ends_at: null },
    outstanding: "44000000", is_behind: false, breach_at: null, foreclosable_at: null, maturity: 0, min_next_bid: null,
    ...rest,
  } as LoanView;
};

const biz = (id: string, operator: string, name = "X", payers = 0): Business =>
  ({ id: `${id}.${R}`, operator, name, stats: { unique_payers: payers } } as unknown as Business);

describe("staged demo loans", () => {
  it("are the loans whose payments fall due every few minutes, read from the loan's own terms", () => {
    expect(isStagedLoan(loan({ window: 300 }))).toBe(true);
    expect(isStagedLoan(loan({ window: 15 }))).toBe(true);
    expect(isStagedLoan(loan({ window: 3_599 }))).toBe(true);
    expect(isStagedLoan(loan({ window: 3_600 }))).toBe(false);
    expect(isStagedLoan(loan({ window: 14 * DAY }))).toBe(false);
  });

  it("are counted apart, so staged takeovers never read as a default rate", () => {
    const stats = loanStats([
      loan({ status: "Repaid", repaid: "22000000", terms: { ...loan({}).terms, total_due: "22000000" }, closed_at: 200 }),
      loan({ window: 300, status: "Sold", foreclosed_at: 150, closed_at: 300, repaid: "12800000" }),
      loan({ window: 300, status: "Foreclosed", foreclosed_at: 150, repaid: "5230000" }),
      loan({ window: 15, status: "Sold", foreclosed_at: 150, closed_at: 300, repaid: "44000000" }),
      loan({ status: "Active", repaid: "2000000" }),
      loan({ status: "Funding", funded: "1000000", activated_at: null }),
    ]);
    expect(stats.loansRepaid).toBe(1);
    expect(stats.loansTakenOver).toBe(0);
    expect(stats.closedRecovered).toBe("22000000");
    expect(stats.closedDue).toBe("22000000");
    expect(stats.staged).toEqual({ loans: 3, repaid: 0, takenOver: 3, closedRecovered: "56800000", closedDue: "88000000", longestWindowSecs: 300 });
    // Money lent still counts every started loan: it really moved.
    expect(stats.lentAllTime).toBe(String(5 * 40_000_000));
  });

  it("a real-clock takeover is still counted as one", () => {
    const stats = loanStats([loan({ status: "Foreclosed", foreclosed_at: 500 })]);
    expect(stats.loansTakenOver).toBe(1);
    expect(stats.staged.takenOver).toBe(0);
  });
});

describe("the team's accounts", () => {
  it("include the role accounts, the agents, the vault and the tap, and their sub-accounts", () => {
    for (const a of ["lien-f1-3833.testnet", "lien-f2-3840.testnet", "lien-lender-645368.testnet", "lien-borrower-648257.testnet", "lien-vault-1.testnet", "lien-tap-9.testnet", "x.lien-f4-3863.testnet", "lien-13569.testnet", `sentinel.${R}`]) {
      expect(isTeamAccount(a), a).toBe(true);
    }
  });
  it("never include visitors' guest accounts or anyone else", () => {
    for (const a of ["gc82j2f.guests.lien-13569.testnet", "lien-guest-abc.testnet", "alice.testnet", "lien-f1.testnet", "evil-lien-f1-3833.testnet"]) {
      expect(isTeamAccount(a), a).toBe(false);
    }
  });
});

describe("where a business is listed", () => {
  it("features the team's businesses, samples or not, and never lists them as started by visitors", () => {
    expect(marketGroup(biz("harbor-48831", "lien-f4-3863.testnet", "Harbor"))).toBe("featured");
    expect(marketGroup(biz("courier-48265", "lien-borrower-648257.testnet", "Courier"))).toBe("featured");
    expect(marketGroup(biz("relay-45042", "lien-f2-3840.testnet", "Relay"))).toBe("featured");
    expect(marketGroup(biz("sentinel", "lien-f1-3833.testnet", "Sentinel"))).toBe("featured");
  });
  it("puts the team's probes apart, and visitors' businesses in their own fold", () => {
    expect(marketGroup(biz("inject-45089", "lien-f4-3863.testnet", "Injection Sample"))).toBe("team");
    expect(marketGroup(biz("critic-ry8n", "g134k3ya.guests.lien-13569.testnet", "Critic Probe"))).toBe("visitors");
    expect(marketGroup(biz("lookout-sale-1729", "grlmfah.guests.lien-13569.testnet", "Lookout", 1))).toBe("visitors");
    expect(marketGroup(biz("shop", "alice.testnet", "Shop", 3))).toBe("featured");
    expect(marketGroup(biz("shop2", "gx.guests.lien-13569.testnet", "Shop", 5))).toBe("visitors");
  });
});

describe("names told apart", () => {
  // The registry lists newest first.
  const all = [
    { id: `lookout-late-38178.${R}`, name: "Lookout" },
    { id: `harbor-48831.${R}`, name: "Harbor" },
    { id: `lookout-late-9219.${R}`, name: "Lookout" },
    { id: `lookout-sale-1729.${R}`, name: "Lookout" },
  ];
  it("numbers staged demos from the oldest, with no account id", () => {
    expect(distinctName(all[3]!, all)).toBe("Lookout · demo 1");
    expect(distinctName(all[2]!, all)).toBe("Lookout · demo 2");
    expect(distinctName(all[0]!, all)).toBe("Lookout · demo 3");
    expect(distinctName(all[1]!, all)).toBe("Harbor");
  });
  it("keeps numbers when a newer twin arrives", () => {
    const later = [{ id: `lookout-late-50000.${R}`, name: "Lookout" }, ...all];
    expect(distinctName(all[2]!, later)).toBe("Lookout · demo 2");
  });
  it("numbers other twins plainly, and leaves a lone non-demo name alone", () => {
    const shops = [{ id: `atlas-2.${R}`, name: "Atlas" }, { id: `atlas.${R}`, name: "Atlas" }];
    expect(distinctName(shops[1]!, shops)).toBe("Atlas · 1");
    expect(distinctName(shops[0]!, shops)).toBe("Atlas · 2");
    expect(distinctName({ id: `lookout.${R}`, name: "Lookout" }, [...all, { id: `lookout.${R}`, name: "Lookout" }])).toBe("Lookout");
  });
});

describe("a report's flags in plain words", () => {
  it("says how many full-access keys, and what that means for a payer", () => {
    const { found, means } = explainFlag("many_full_access_keys", { keys: [5, 0] });
    expect(`${found}: ${means}`).toBe("5 full-access keys: many people or machines can change this account or empty it.");
    expect(explainFlag("owner_can_replace_contract_code", { keys: [1, 0] }).found).toBe("1 full-access key on a contract");
    expect(explainFlag("something_new", { keys: [0, 0] }).found).toBe("something new");
  });
});

describe("the activity feed's words", () => {
  it("mentions lenders only when a loan was running at the time of the sale", () => {
    expect(saleText("$0.25", [], 500)).toBe("sold a safety check for $0.25");
    const repaid = loan({ status: "Repaid", activated_at: 100, closed_at: 200 });
    expect(saleText("$0.25", [repaid], 500)).toBe("sold a safety check for $0.25");
    expect(saleText("$0.25", [repaid], 150)).toMatch(/lenders were paid their share/);
    expect(saleText("$0.25", [loan({ status: "Funding", activated_at: null })], 500)).toBe("sold a safety check for $0.25");
    expect(saleText("$0.25", [loan({ status: "Foreclosed", foreclosed_at: 300 })], 400)).toMatch(/owner's share too/);
  });
});
