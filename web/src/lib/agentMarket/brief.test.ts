import { describe, expect, it } from "vitest";
import { parseBrief, parseBriefs } from "./brief";

describe("finding the account in an Agent Market brief", () => {
  it("reads a mainnet account and picks mainnet", () => {
    expect(parseBrief("Check alice.near")).toEqual({ accountId: "alice.near", network: "mainnet" });
    expect(parseBrief("Please run a risk check on the NEAR account `sweat_welcome.near` before I pay it.")).toEqual({
      accountId: "sweat_welcome.near",
      network: "mainnet",
    });
    expect(parseBrief("Is wrap.near safe to send to?")).toEqual({ accountId: "wrap.near", network: "mainnet" });
  });

  it("reads a testnet account and picks testnet", () => {
    expect(parseBrief("Risk check: sentinel.v1.lien-13569.testnet.")).toEqual({ accountId: "sentinel.v1.lien-13569.testnet", network: "testnet" });
    expect(parseBrief("account=Bob-1.Testnet please")).toEqual({ accountId: "bob-1.testnet", network: "testnet" });
  });

  it("does not take the bare words NEAR or testnet for accounts", () => {
    expect(parseBrief("Check this NEAR testnet account: carol.testnet")).toEqual({ accountId: "carol.testnet", network: "testnet" });
  });

  it("takes the account out of an explorer link and ignores host names", () => {
    expect(parseBrief("https://nearblocks.io/address/dave.near")).toEqual({ accountId: "dave.near", network: "mainnet" });
    expect(parseBrief("I found you on market.near.ai, can you check stuff?")).toBeNull();
  });

  it("takes the first account when there are several", () => {
    expect(parseBrief("Compare eve.near with frank.testnet")).toEqual({ accountId: "eve.near", network: "mainnet" });
  });

  it("reads an implicit account, on mainnet unless the brief says testnet", () => {
    const hex = "98793cd91a3f870fb126f66285808c7e094afcfc4eda8a970f6648cdf0dbd6de";
    expect(parseBrief(`check ${hex}`)).toEqual({ accountId: hex, network: "mainnet" });
    expect(parseBrief(`check ${hex.toUpperCase()} on testnet`)).toEqual({ accountId: hex, network: "testnet" });
  });

  it("finds nothing in a brief without an account", () => {
    for (const text of ["", "Check my wallet please", "near", "testnet", "a..near", `${"a".repeat(70)}.near`, "x.near.org"]) {
      expect(parseBrief(text)).toBeNull();
    }
  });

  it("prefers the buyer's newest message over the original brief", () => {
    expect(parseBriefs("Sorry, I meant grace.testnet", "Check heidi.near")).toEqual({ accountId: "grace.testnet", network: "testnet" });
    expect(parseBriefs(null, "Check heidi.near")).toEqual({ accountId: "heidi.near", network: "mainnet" });
    expect(parseBriefs("thanks!", undefined)).toBeNull();
  });
});
