import { describe, expect, it } from "vitest";
import { assess, NO_FACTS, parseFacts, parseTarget, verdictOf, type Facts } from "./risk";

// The same cases as the Rust tests in agents/sentinel/src/risk.rs, so the free check in
// the app and the paid check in the TEE cannot drift apart.
const facts = (over: Partial<Facts> = {}): Facts => ({ exists: true, hasContract: false, fullAccessKeys: 1, functionCallKeys: 0, balanceNear: 10, storageBytes: 200, ...over });

describe("risk rules, as in risk.rs", () => {
  it("finds the account in a sentence", () => {
    expect(parseTarget("is bob.near safe?")).toBe("bob.near");
    expect(parseTarget("  Alice.Testnet ")).toBe("alice.testnet");
    expect(parseTarget("usdc.near.")).toBe("usdc.near");
  });

  it("rejects input without an account", () => {
    expect(parseTarget("hello world")).toBeNull();
    expect(parseTarget("")).toBeNull();
    expect(parseTarget("a..near")).toBeNull();
    expect(parseTarget(`${"a".repeat(70)}.near`)).toBeNull();
  });

  it("accepts an implicit account", () => {
    const hex = "ab".repeat(32);
    expect(parseTarget(hex)).toBe(hex);
  });

  it("a plain funded account is low risk", () => {
    const r = assess("a.near", "mainnet", facts());
    expect(r.score).toBe(0);
    expect(r.level).toBe("low");
    expect(r.flags).toEqual([]);
  });

  it("a missing account is high risk", () => {
    const r = assess("gone.near", "mainnet", NO_FACTS);
    expect(r.level).toBe("high");
    expect(r.flags).toEqual(["account_does_not_exist"]);
  });

  it("an upgradable contract is flagged", () => {
    const r = assess("c.near", "mainnet", facts({ hasContract: true, storageBytes: 400_000 }));
    expect(r.flags).toEqual(["owner_can_replace_contract_code"]);
    expect(r.level).toBe("medium");
  });

  it("a keyless contract is noted as good", () => {
    const r = assess("c.near", "mainnet", facts({ hasContract: true, fullAccessKeys: 0, storageBytes: 400_000 }));
    expect(r.score).toBe(0);
    expect(r.flags).toEqual(["contract_is_locked_no_one_can_change_it"]);
  });

  it("scores never pass 100", () => {
    const r = assess("c.near", "mainnet", facts({ hasContract: true, fullAccessKeys: 9, balanceNear: 0, storageBytes: 10 }));
    expect(r.score).toBeLessThanOrEqual(100);
    expect(r.level).toBe("high");
  });
});

describe("verdicts", () => {
  it("maps each risk.rs level to one verdict", () => {
    expect(verdictOf("low")).toBe("ALLOW");
    expect(verdictOf("medium")).toBe("WARN");
    expect(verdictOf("high")).toBe("BLOCK");
    expect(verdictOf("unknown")).toBe("BLOCK");
  });

  it("puts the level boundaries where risk.rs does", () => {
    expect(assess("x.near", "testnet", facts({ balanceNear: 0 })).verdict).toBe("ALLOW"); // 15
    expect(assess("x.near", "testnet", facts({ fullAccessKeys: 4 })).verdict).toBe("WARN"); // 20
    expect(assess("x.near", "testnet", facts({ fullAccessKeys: 0 })).verdict).toBe("BLOCK"); // 50
  });

  it("rates a keyless Lien business on global code the way the deployed Sentinel does", () => {
    // Global contract code is not stored on the account, so it reads as a small contract.
    const f = parseFacts({ amount: "909367799999999999999965", code_hash: "11111111111111111111111111111111", global_contract_hash: "5h7G", storage_usage: 13792 }, { keys: [] });
    expect(f).toMatchObject({ hasContract: true, fullAccessKeys: 0, balanceNear: 0 });
    const r = assess("sentinel.v1.lien-13569.testnet", "testnet", f);
    expect(r.flags).toEqual(["contract_is_locked_no_one_can_change_it", "almost_no_balance", "very_small_contract"]);
    expect(r).toMatchObject({ score: 25, level: "medium", verdict: "WARN" });
  });

  it("counts full-access and function-call keys from the RPC shape", () => {
    const f = parseFacts({ amount: "5000000000000000000000000", code_hash: "abc", storage_usage: 400_000 }, { keys: [{ access_key: { permission: "FullAccess" } }, { access_key: { permission: { FunctionCall: {} } } }] });
    expect(f).toEqual({ exists: true, hasContract: true, fullAccessKeys: 1, functionCallKeys: 1, balanceNear: 5, storageBytes: 400_000 });
  });
});
