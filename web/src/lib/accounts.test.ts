import { describe, expect, it } from "vitest";
import { hasAccountName, isAccountId, labelProblem } from "./accounts";

describe("hasAccountName", () => {
  it("finds an account, alone or in a sentence", () => {
    for (const ok of ["outlayer.testnet", "is outlayer.testnet safe?", "check usd.lien-13569.testnet", "wrap.near", "a".repeat(64)]) {
      expect(hasAccountName(ok)).toBe(true);
    }
  });
  it("refuses text with no account in it", () => {
    for (const bad of ["hello world", "there is no account in this sentence", "a".repeat(300), "<script>", "testnet", ".testnet", ""]) {
      expect(hasAccountName(bad)).toBe(false);
    }
  });
});

describe("account ids and labels", () => {
  it("validates ids", () => {
    expect(isAccountId("buyer.testnet")).toBe(true);
    expect(isAccountId("not an account")).toBe(false);
    expect(isAccountId("a")).toBe(false);
  });
  it("explains what is wrong with a label", () => {
    expect(labelProblem("scout")).toBeNull();
    expect(labelProblem("ok-name_1")).toBeNull();
    expect(labelProblem("a")).toMatch(/at least 2/);
    expect(labelProblem("x".repeat(80))).toMatch(/at most 32/);
    expect(labelProblem("Scout")).toMatch(/lowercase/);
    expect(labelProblem("sc out")).toMatch(/only letters/);
    expect(labelProblem("-scout")).toMatch(/Start and end/);
  });
});
