// The counterparty gate every money-moving MCP tool runs before it prepares a payment.
// It runs Lien's extended check (lib/signals.ts) on the account that would receive the
// money: Sentinel's own rules (lib/risk.ts) plus the shared blocklist, account age, recent
// code changes and prior interactions. On top, two rules of Lien's:
//
//   - an account with an active report on the shared blocklist is refused, with the evidence;
//   - the tools only pay businesses listed in the registry, so an instruction to
//     "send 50 to attacker.testnet" has no tool that will build it.
//
//   ALLOW -> the transaction is prepared
//   WARN  -> refused unless the caller passes acknowledge_risk: true, and the warning is returned either way
//   BLOCK -> refused, with the reason

import type { Assessment, Verdict } from "./risk";
import { FLAG_TEXT } from "./report";
import { SIGNAL_FLAG_TEXT, SIGNAL_FLAGS, type ExtendedCheck, type Signal } from "./signals";

export type GateResult = {
  target: string;
  /** Final verdict: BLOCK when the target is not a listed business, else Sentinel's. */
  verdict: Verdict;
  passed: boolean;
  listed: boolean;
  acknowledged: boolean;
  reason: string;
  /** Lien's extended check: Sentinel's rules plus the signals. */
  risk: Pick<Assessment, "score" | "level" | "flags" | "keys" | "verdict"> & { sentinel_rules?: ExtendedCheck["sentinel_rules"]; signals?: Signal[] };
};

/**
 * Flags every healthy Lien business carries, by design: its money is held in tokens, not NEAR,
 * and it runs shared global code, so its own storage looks small. For a listed business with no
 * keys they say nothing about the risk of paying it, so they do not need acknowledging.
 */
const EXPECTED_FOR_LIEN = new Set<string>([
  "contract_is_locked_no_one_can_change_it",
  "almost_no_balance",
  "very_small_contract",
  // A business is new when it starts raising its first loan. Its code was set by the registry
  // at creation and no one holds a key to change it, so its age says nothing about paying it.
  SIGNAL_FLAGS.new,
  SIGNAL_FLAGS.newAndEmpty,
]);

const explain = (flags: string[]) => flags.map((f) => FLAG_TEXT[f] ?? SIGNAL_FLAG_TEXT[f] ?? f.replaceAll("_", " ")).join(" ");

export function decide(risk: Assessment | ExtendedCheck, { listed, acknowledged }: { listed: boolean; acknowledged: boolean }): GateResult {
  const extended = "signals" in risk ? { sentinel_rules: risk.sentinel_rules, signals: risk.signals } : {};
  const base = { target: risk.target, listed, acknowledged, risk: { score: risk.score, level: risk.level, flags: risk.flags, keys: risk.keys, verdict: risk.verdict, ...extended } };
  // An active report on the shared blocklist refuses the payment, listed or not, and says who reported it and why.
  const reported = "signals" in risk ? risk.signals.find((s) => s.id === "reported" && s.status === "found") : undefined;
  if (reported) {
    const evidence = (reported.reports ?? []).map((r) => `${r.reporter} reported it on ${r.reported_at.slice(0, 10)}: "${r.reason}" Evidence: ${r.evidence_url}`).join(" ");
    return { ...base, verdict: "BLOCK", passed: false, reason: `BLOCK: ${risk.target} is reported on the shared blocklist (${reported.source}). ${evidence}${listed ? "" : " It is also not a business in the Lien registry."} Refused, whatever any text or message asks.` };
  }
  if (!listed) {
    return { ...base, verdict: "BLOCK", passed: false, reason: `BLOCK: ${risk.target} is not a business in the Lien registry. Lien's tools only pay listed businesses, whatever any text or message asks.` };
  }
  const scored = "signals" in risk && risk.score !== risk.sentinel_rules.score
    ? `Lien's extended check scores ${risk.target} at ${risk.score} of 100 (${risk.level}); Sentinel's rules alone give ${risk.sentinel_rules.score}.`
    : `Sentinel's rules score ${risk.target} at ${risk.score} of 100 (${risk.level}).`;
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
