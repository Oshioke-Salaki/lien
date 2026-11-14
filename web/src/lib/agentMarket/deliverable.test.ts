import { describe, expect, it } from "vitest";
import { assess, NO_FACTS, type Facts } from "../risk";
import { renderDeliverable, SENTINEL_URL } from "./deliverable";

const funded: Facts = { exists: true, hasContract: false, fullAccessKeys: 1, functionCallKeys: 2, balanceNear: 42, storageBytes: 512 };

describe("the Agent Market deliverable", () => {
  it("states the account, network, score, level, verdict and its meaning", () => {
    const md = renderDeliverable({ accountId: "alice.near", network: "mainnet", facts: funded, assessment: assess("alice.near", "mainnet", funded) });
    expect(md).toContain("# Sentinel risk check: `alice.near`");
    expect(md).toContain("| Network | NEAR mainnet |");
    expect(md).toContain("**0 / 100**");
    expect(md).toContain("| Level | low |");
    expect(md).toContain("**ALLOW** means: Allow: nothing stands out.");
    expect(md).toContain("- None.");
  });

  it("lists the facts read and how to check them", () => {
    const md = renderDeliverable({ accountId: "alice.near", network: "mainnet", facts: funded, assessment: assess("alice.near", "mainnet", funded) });
    expect(md).toContain("| Full-access keys | 1 |");
    expect(md).toContain("| Function-call keys | 2 |");
    expect(md).toContain("| Contract deployed | no |");
    expect(md).toContain("| Balance | 42 NEAR");
    expect(md).toContain("https://nearblocks.io/address/alice.near");
    expect(md).toContain('"request_type":"view_access_key_list","finality":"optimistic","account_id":"alice.near"');
    expect(md).toContain("https://free.rpc.fastnear.com");
  });

  it("names the pinned build, the TEE, and where to buy the attested check", () => {
    const md = renderDeliverable({ accountId: "alice.near", network: "mainnet", facts: funded, assessment: assess("alice.near", "mainnet", funded) });
    expect(md).toContain("pinned build `b440dfe2…`");
    expect(md).toContain("b440dfe287452a6edcdc430f3375b664092aeb18eae584925b3c2ef3f842acd5");
    expect(md).toContain("Intel TDX on OutLayer");
    expect(md).toContain("run by Lien's server");
    expect(md).toContain(SENTINEL_URL);
    expect(SENTINEL_URL).toBe("https://lien-five.vercel.app/b/sentinel.v1.lien-13569.testnet");
  });

  it("explains each flag in plain words, for a risky testnet account", () => {
    const risky: Facts = { exists: true, hasContract: true, fullAccessKeys: 5, functionCallKeys: 0, balanceNear: 0, storageBytes: 1000 };
    const assessment = assess("shady.testnet", "testnet", risky);
    const md = renderDeliverable({ accountId: "shady.testnet", network: "testnet", facts: risky, assessment });
    expect(assessment.verdict).toBe("BLOCK");
    expect(md).toContain("**BLOCK** means: Block: do not pay this account.");
    expect(md).toContain("- **owner_can_replace_contract_code**: Its owner holds a key and can replace the contract at any time.");
    expect(md).toContain("- **many_full_access_keys**: Many people or machines can control this account.");
    expect(md).toContain("- **almost_no_balance**: It holds almost no NEAR.");
    expect(md).toContain("- **very_small_contract**: Its contract is unusually small.");
    expect(md).toContain("https://testnet.nearblocks.io/address/shady.testnet");
    expect(md).toContain("https://rpc.testnet.fastnear.com");
  });

  it("reports a missing account, and renders the same bytes every time", () => {
    const input = { accountId: "gone.near", network: "mainnet" as const, facts: NO_FACTS, assessment: assess("gone.near", "mainnet", NO_FACTS) };
    const md = renderDeliverable(input);
    expect(md).toContain("| Account exists | no |");
    expect(md).toContain("This account does not exist.");
    expect(renderDeliverable(input)).toBe(md);
  });
});
