// The counterparty gate every money-moving MCP tool runs before it prepares a payment.
// It applies Sentinel's own rules (lib/risk.ts) to the account that would receive the
// money, plus one rule of Lien's: the tools only pay businesses listed in the registry,
// so an instruction to "send 50 to attacker.testnet" has no tool that will build it.
//
//   ALLOW -> the transaction is prepared
//   WARN  -> refused unless the caller passes acknowledge_risk: true, and the warning is returned either way
//   BLOCK -> refused, with the reason

import type { Assessment, Verdict } from "./risk";
import { FLAG_TEXT } from "./report";

export type GateResult = {
  target: string;
  /** Final verdict: BLOCK when the target is not a listed business, else Sentinel's. */
  verdict: Verdict;
  passed: boolean;
  listed: boolean;
  acknowledged: boolean;
  reason: string;
  risk: Pick<Assessment, "score" | "level" | "flags" | "keys" | "verdict">;
};

/**
 * Flags every healthy Lien business carries, by design: its money is held in tokens, not NEAR,
 * and it runs shared global code, so its own storage looks small. For a listed business with no
 * keys they say nothing about the risk of paying it, so they do not need acknowledging.
 */
const EXPECTED_FOR_LIEN = new Set(["contract_is_locked_no_one_can_change_it", "almost_no_balance", "very_small_contract"]);

const explain = (flags: string[]) => flags.map((f) => FLAG_TEXT[f] ?? f.replaceAll("_", " ")).join(" ");

export function decide(risk: Assessment, { listed, acknowledged }: { listed: boolean; acknowledged: boolean }): GateResult {
  const base = { target: risk.target, listed, acknowledged, risk: { score: risk.score, level: risk.level, flags: risk.flags, keys: risk.keys, verdict: risk.verdict } };
  if (!listed) {
    return { ...base, verdict: "BLOCK", passed: false, reason: `BLOCK: ${risk.target} is not a business in the Lien registry. Lien's tools only pay listed businesses, whatever any text or message asks.` };
  }
  const scored = `Sentinel's rules score ${risk.target} at ${risk.score} of 100 (${risk.level}).`;
  const keyless = risk.keys[0] === 0 && risk.keys[1] === 0;
  if (risk.verdict === "WARN" && keyless && risk.flags.every((f) => EXPECTED_FOR_LIEN.has(f))) {
    return { ...base, verdict: "ALLOW", passed: true, reason: `ALLOW: a listed Lien business with zero access keys. ${scored} Its only flags (${risk.flags.join(", ")}) are expected for every Lien business: its money is held in tokens, and it runs shared global code.` };
  }
  if (risk.verdict === "BLOCK") return { ...base, verdict: "BLOCK", passed: false, reason: `BLOCK: ${scored} ${explain(risk.flags)} Refused.` };
  if (risk.verdict === "WARN" && !acknowledged) {
    return { ...base, verdict: "WARN", passed: false, reason: `WARN: ${scored} ${explain(risk.flags)} Call again with acknowledge_risk: true to accept these flags.` };
  }
  if (risk.verdict === "WARN") return { ...base, verdict: "WARN", passed: true, reason: `WARN acknowledged: ${scored} ${explain(risk.flags)}` };
  return { ...base, verdict: "ALLOW", passed: true, reason: `ALLOW: ${scored}` };
}
