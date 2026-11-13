import { describe, expect, it } from "vitest";
import { amount, centsUp, dateTime, duration, fromNow, inputAmount, money, moneyExact, moneyUp, parseAmount, pct, percent, share, shortAccount, smartAmount, toYocto, nearAmount } from "./format";

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
    expect(duration(7_200)).toBe("2 hours");
    expect(duration(86_400)).toBe("24 hours");
    expect(duration(46.9 * 86_400)).toBe("47 days");
    expect(duration(4.9 * 86_400)).toBe("5 days");
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

describe("money", () => {
  it("shows dollars to the cent, rounding half up", () => {
    expect(money("94475000")).toBe("$94.48");
    expect(money("15725000")).toBe("$15.73");
    expect(money("116150000")).toBe("$116.15");
    expect(money(0n)).toBe("$0.00");
    expect(money(-1_505_000n)).toBe("-$1.51");
  });
  it("never shows a positive amount as $0.00", () => {
    expect(money("1000")).toBe("<$0.01");
    expect(money("5000")).toBe("$0.01");
  });
  it("rounds minimums up, so the shown value is accepted", () => {
    expect(moneyUp("19385000")).toBe("$19.39");
    expect(centsUp("19385000")).toBe(19_390_000n);
    expect(centsUp("19380000")).toBe(19_380_000n);
  });
  it("keeps exact amounts where parts must add up", () => expect(moneyExact("75000")).toBe("$0.075"));
  it("fills inputs with a clean number", () => {
    expect(inputAmount("15000000")).toBe("15");
    expect(inputAmount("12500000")).toBe("12.5");
    expect(inputAmount("1234567000000")).toBe("1234567");
  });
});

describe("display rules a newcomer sees", () => {
  it("shows percentages as whole numbers, with decimals only under 1%", () => {
    expect(pct(74)).toBe("74%");
    expect(pct(15.09)).toBe("15%");
    expect(pct(0.37)).toBe("0.37%");
    expect(pct(0)).toBe("0%");
  });
  it("shortens account names at a dot, never inside a word", () => {
    expect(shortAccount("g134k3ya.guests.lien-13569.testnet", 24)).toBe("g134k3ya….testnet");
    expect(shortAccount("bob.testnet")).toBe("bob.testnet");
  });
  it("prints times in UTC, the same on the server and in every browser", () => {
    expect(dateTime(1_794_573_403)).toMatch(/UTC$/);
    expect(dateTime(0)).toBe("1 Jan, 00:00 UTC");
  });
});
