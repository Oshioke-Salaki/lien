import { describe, expect, it } from "vitest";
import { checkAmount } from "./amounts";

describe("checkAmount", () => {
  it("names a decimal comma instead of misreading it", () => {
    expect(checkAmount("1,5", {}).error).toMatch(/Use a dot for decimals/);
    expect(checkAmount("1,000", {}).value).toBe(1_000_000_000n);
  });
  it("refuses zero, negatives, letters and extra decimals with a reason", () => {
    expect(checkAmount("0", {}).error).toMatch(/more than zero/);
    expect(checkAmount("-1", {}).error).toMatch(/positive/);
    expect(checkAmount("abc", {}).error).toMatch(/amount in dollars/);
    expect(checkAmount("1.234", {}).error).toMatch(/two decimal places/);
  });
});
