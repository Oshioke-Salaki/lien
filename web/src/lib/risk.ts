// Sentinel's risk rules, ported line for line from agents/sentinel/src/risk.rs and
// chain.rs so the app and the MCP server can run the same deterministic check for
// free before any money moves. The paid Sentinel check runs the Rust original inside
// a TEE; this port must give the same score for the same chain state, and
// risk.test.ts repeats the Rust test cases to hold it to that.
//
// The verdict is a policy on top of the score, one per risk.rs level:
//   low    (score  0-19) -> ALLOW  nothing stands out
//   medium (score 20-49) -> WARN   allowed only with an explicit acknowledgement
//   high   (score 50-100) -> BLOCK refused

export type Facts = {
  exists: boolean;
  hasContract: boolean;
  fullAccessKeys: number;
  functionCallKeys: number;
  /** Whole NEAR, rounded down, as the Rust u128 division does. */
  balanceNear: number;
  storageBytes: number;
};

export type Level = "low" | "medium" | "high";
export type Verdict = "ALLOW" | "WARN" | "BLOCK";

export type Assessment = {
  target: string;
  network: string;
  score: number;
  level: Level;
  flags: string[];
  keys: [number, number];
  verdict: Verdict;
};

export const NO_FACTS: Facts = { exists: false, hasContract: false, fullAccessKeys: 0, functionCallKeys: 0, balanceNear: 0, storageBytes: 0 };

export function levelOf(score: number): Level {
  if (score <= 19) return "low";
  if (score <= 49) return "medium";
  return "high";
}

const VERDICT: Record<Level, Verdict> = { low: "ALLOW", medium: "WARN", high: "BLOCK" };
export const verdictOf = (level: string): Verdict => VERDICT[level as Level] ?? "BLOCK";

/** What each verdict means, for people and for agents reading MCP results. */
export const VERDICT_TEXT: Record<Verdict, string> = {
  ALLOW: "Allow: nothing stands out.",
  WARN: "Warn: proceed only if you accept the flags listed.",
  BLOCK: "Block: do not pay this account.",
};

export function assess(target: string, network: string, facts: Facts): Assessment {
  let score = 0;
  const flags: string[] = [];
  const add = (points: number, flag: string) => {
    score = Math.min(255, score + points); // u8 saturating_add
    flags.push(flag);
  };
  if (!facts.exists) {
    add(90, "account_does_not_exist");
  } else {
    if (facts.hasContract && facts.fullAccessKeys > 0) add(40, "owner_can_replace_contract_code");
    if (facts.hasContract && facts.fullAccessKeys === 0) add(0, "contract_is_locked_no_one_can_change_it");
    if (!facts.hasContract && facts.fullAccessKeys === 0 && facts.functionCallKeys === 0) add(50, "account_is_locked_with_no_code");
    if (facts.fullAccessKeys > 3) add(20, "many_full_access_keys");
    if (facts.balanceNear < 1) add(15, "almost_no_balance");
    if (facts.hasContract && facts.storageBytes < 50_000) add(10, "very_small_contract");
  }
  score = Math.min(score, 100);
  const level = levelOf(score);
  return { target, network, score, level, flags, keys: [facts.fullAccessKeys, facts.functionCallKeys], verdict: verdictOf(level) };
}

const NO_CODE = "11111111111111111111111111111111";
const YOCTO_PER_NEAR = 10n ** 24n;

type RawState = { amount?: string; code_hash?: string; global_contract_hash?: unknown; global_contract_account_id?: unknown; storage_usage?: number };
type RawKeys = { keys?: Array<{ access_key?: { permission?: unknown } }> };

/** chain.rs parse_facts: view_account and view_access_key_list results into facts. */
export function parseFacts(state: RawState, keys: RawKeys): Facts {
  let full = 0, limited = 0;
  for (const key of keys.keys ?? []) {
    if (key.access_key?.permission === "FullAccess") full += 1;
    else limited += 1;
  }
  const codeHash = typeof state.code_hash === "string" ? state.code_hash : NO_CODE;
  const global = typeof state.global_contract_hash === "string" || typeof state.global_contract_account_id === "string";
  let yocto = 0n;
  try { yocto = BigInt(state.amount ?? "0"); } catch { yocto = 0n; }
  return {
    exists: true,
    hasContract: codeHash !== NO_CODE || global,
    fullAccessKeys: full,
    functionCallKeys: limited,
    balanceNear: Number(yocto / YOCTO_PER_NEAR),
    storageBytes: state.storage_usage ?? 0,
  };
}

/** risk.rs parse_target: a bare account, or a sentence with one in it. */
export function parseTarget(input: string): string | null {
  const words = input.split(/[\s,;"'?()]+/).map((w) => w.replace(/\.+$/, "").toLowerCase());
  return words.find(isAccount) ?? null;
}

function isAccount(word: string): boolean {
  const named = word.endsWith(".near") || word.endsWith(".testnet") || word === "near" || word === "testnet";
  const implicit = word.length === 64 && /^[0-9a-fA-F]+$/.test(word);
  return (named || implicit) && word.length >= 2 && word.length <= 64 && /^[a-z0-9._-]+$/.test(word) && !word.includes("..");
}
