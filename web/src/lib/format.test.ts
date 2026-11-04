import { describe, expect, it } from "vitest";
import { amount, duration, fromNow, parseAmount, percent, share, shortAccount, smartAmount, toYocto, nearAmount } from "./format";

describe("amount", () => {
  it("formats base units", () => {
    expect(amount("1234567")).toBe("1.23");
    expect(amount(1_234_567_890_000n)).toBe("1,234,567.89");
    expect(amount(0n)).toBe("0.00");
    expect(amount(-1_500_000n)).toBe("-1.50");
  });
  it("never rounds up past what is held", () => expect(amount("999999")).toBe("0.99"));
  it("is exact, so parts add up on screen", () => {
    expect(smartAmount("20000")).toBe("0.02");
    expect(smartAmount("1234")).toBe("0.001234");
    expect(smartAmount("0")).toBe("0.00");
    expect(smartAmount("75000")).toBe("0.075");
    expect(smartAmount("1500000")).toBe("1.50");
    expect(smartAmount("110000000")).toBe("110.00");
    expect(smartAmount("1234567000000")).toBe("1,234,567.00");
  });
});

describe("parseAmount", () => {
  it("parses what people type", () => {
    expect(parseAmount("12.5")).toBe(12_500_000n);
    expect(parseAmount("1,000")).toBe(1_000_000_000n);
    expect(parseAmount(".5")).toBe(500_000n);
    expect(parseAmount("7")).toBe(7_000_000n);
    expect(parseAmount("0.000001")).toBe(1n);
  });
  it("refuses what is not an amount", () => {
    for (const bad of ["", ".", "abc", "1.2.3", "-1", "1e5", "0.0000001"]) expect(parseAmount(bad)).toBeNull();
  });
  it("round-trips", () => expect(parseAmount(amount(12_340_000n))).toBe(12_340_000n));
});

describe("time", () => {
  it("reads durations", () => {
    expect(duration(30)).toBe("30s");
    expect(duration(120)).toBe("2 min");
    expect(duration(7_200)).toBe("2 h");
    expect(duration(86_400)).toBe("1 day");
    expect(duration(-5)).toBe("0s");
  });
  it("reads relative moments", () => {
    expect(fromNow(160, 100)).toBe("in 1 min");
    expect(fromNow(40, 100)).toBe("1 min ago");
    expect(fromNow(100, 100)).toBe("now");
  });
});

describe("others", () => {
  it("percent", () => { expect(percent(3_000)).toBe("30%"); expect(percent(1_250)).toBe("12.50%"); });
  it("share", () => { expect(share(1n, 4n)).toBe(25); expect(share(1n, 0n)).toBe(0); });
  it("shortAccount", () => {
    expect(shortAccount("a.near")).toBe("a.near");
    expect(shortAccount("a".repeat(64)).length).toBeLessThanOrEqual(28);
  });
  it("near conversion", () => {
    expect(toYocto("1")).toBe("1000000000000000000000000");
    expect(toYocto("0.05")).toBe("50000000000000000000000");
    expect(nearAmount("1500000000000000000000000")).toBe("1.50");
  });
});
