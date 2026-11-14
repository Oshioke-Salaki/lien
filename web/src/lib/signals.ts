// Lien's extended counterparty check: Sentinel's deterministic rules (lib/risk.ts, the same
// rules the deployed Sentinel runs, unchanged) plus four signals Sentinel does not read.
// This is Lien's check, built on Sentinel's rules; the paid Sentinel check run inside a TEE
// does not include these signals.
//
//   signal               source                                         effect on the score
//   reported             the shared blocklist, contracts/reports        +100: an active report always means BLOCK
//                        (view get_reports, read fresh from the chain)
//   account_age          NearBlocks: creation time and recent txns      +20 if under 1 day old with no activity
//                                                                       beyond its creation, +10 if under 1 day old
//   recent_code_change   NearBlocks: contract deployments               +15 if code was deployed in the last 7 days
//                                                                       by anything other than the account's creation
//   prior_interactions   NearBlocks: transactions the caller signed     0: shown, never lowers the score, so one
//                        to it, token transfers between the two         staged interaction cannot buy a pass
//
// The score is Sentinel's score plus these points, capped at 100, mapped to ALLOW/WARN/BLOCK
// with Sentinel's own thresholds (risk.ts levelOf). Points only ever add, so the extended
// verdict is never kinder than Sentinel's. A signal whose source does not answer in time is
// marked "unavailable" and adds nothing; the check never fails because NearBlocks is down.
//
// This file has no framework imports, so lib/checkBeforeSign.ts can be used outside the app.

import reportsTestnet from "../../../deployments/reports-testnet.json";
import { levelOf, verdictOf, type Assessment, type Facts, type Level, type Verdict } from "./risk";

export type SignalNetwork = "testnet" | "mainnet";

/** The keyless shared blocklist (contracts/reports). Not deployed on mainnet. */
export const REPORTS_REGISTRY: Record<SignalNetwork, string | null> = { testnet: reportsTestnet.registry, mainnet: null };
export const NEARBLOCKS_API: Record<SignalNetwork, string> = { testnet: "https://api-testnet.nearblocks.io", mainnet: "https://api.nearblocks.io" };
export const NEARBLOCKS_WEB: Record<SignalNetwork, string> = { testnet: "https://testnet.nearblocks.io", mainnet: "https://nearblocks.io" };

export const RULES = {
  reportedPoints: 100,
  newAccountMs: 24 * 60 * 60 * 1000,
  newAndEmptyPoints: 20,
  newAccountPoints: 10,
  recentCodeMs: 7 * 24 * 60 * 60 * 1000,
  recentCodePoints: 15,
  priorInteractionPoints: 0,
  /** How long to wait for NearBlocks before marking a signal unavailable. */
  timeoutMs: 3_500,
} as const;

export const SIGNAL_FLAGS = {
  reported: "reported_on_shared_blocklist",
  newAndEmpty: "new_account_no_activity",
  new: "account_under_a_day_old",
  recentCode: "code_changed_recently",
} as const;

export const SIGNAL_FLAG_TEXT: Record<string, string> = {
  [SIGNAL_FLAGS.reported]: "It is reported on the shared blocklist; see who reported it and their evidence.",
  [SIGNAL_FLAGS.newAndEmpty]: "It was created less than a day ago and has done nothing since.",
  [SIGNAL_FLAGS.new]: "It was created less than a day ago.",
  [SIGNAL_FLAGS.recentCode]: "Its contract code changed in the last 7 days.",
};

export type SignalId = "reported" | "account_age" | "recent_code_change" | "prior_interactions";
export type SignalStatus = "found" | "clear" | "unavailable" | "not_applicable";

export type BlocklistReport = { id: number; reporter: string; reason: string; evidence_url: string; reported_at: string };

export type Signal = {
  id: SignalId;
  status: SignalStatus;
  /** Points added to the score. */
  points: number;
  /** The flag added to the flags list when the signal scores. */
  flag?: string;
  /** One sentence, plain words. */
  summary: string;
  /** Where it was read: a contract view or an explorer link a person can open. */
  source: string;
  /** For `reported`: every active report, with the reporter and the evidence. */
  reports?: BlocklistReport[];
};

export type ExtendedCheck = {
  target: string;
  network: string;
  /** Sentinel's score plus the signals' points, capped at 100. */
  score: number;
  level: Level;
  flags: string[];
  keys: [number, number];
  verdict: Verdict;
  check: string;
  /** Sentinel's rules alone, unchanged: what the deployed Sentinel would say. */
  sentinel_rules: Pick<Assessment, "score" | "level" | "flags" | "verdict">;
  signals: Signal[];
  reported: boolean;
};

export const CHECK_NAME = "Lien's extended check, built on Sentinel's rules";

/** Combines Sentinel's assessment with the signals. Points only add; an active report is always BLOCK. */
export function combine(base: Assessment, signals: Signal[]): ExtendedCheck {
  const scoring = signals.filter((s) => s.status === "found" && s.points !== 0);
  const raw = base.score + scoring.reduce((sum, s) => sum + s.points, 0);
  const score = Math.max(base.score, Math.min(100, raw));
  const reported = signals.some((s) => s.id === "reported" && s.status === "found");
  const level = reported ? "high" : levelOf(score);
  return {
    target: base.target,
    network: base.network,
    score: reported ? 100 : score,
    level,
    flags: [...base.flags, ...scoring.flatMap((s) => (s.flag ? [s.flag] : []))],
    keys: base.keys,
    verdict: reported ? "BLOCK" : verdictOf(level),
    check: CHECK_NAME,
    sentinel_rules: { score: base.score, level: base.level, flags: base.flags, verdict: base.verdict },
    signals,
    reported,
  };
}

// ---------------------------------------------------------------- reading the signals

/** A report as contracts/reports returns it. */
export type RawReport = { id: number; account: string; reporter: string; reason: string; evidence_url: string; created_at_ms: number; retracted_at_ms: number | null };

export type SignalDeps = {
  /** GET a NearBlocks path, parsed JSON. Throws on a timeout, a rate limit or a bad answer. */
  nearblocks: (path: string) => Promise<unknown>;
  /** contracts/reports get_reports for an account. */
  reports: (registry: string, account: string) => Promise<RawReport[]>;
  now: () => number;
};

type CacheEntry = { at: number; value?: unknown; error?: string };
const cache = new Map<string, CacheEntry>();
const HIT_MS = 5 * 60 * 1000;
const MISS_MS = 60 * 1000;

/**
 * GETs NearBlocks with a timeout. Answers are kept for 5 minutes and failures for 1, so a
 * burst of checks on one account (an agent retrying, the injection demo) costs one request.
 * NEARBLOCKS_API_KEY, when set, is sent as a bearer token for the higher rate limit.
 */
export function nearblocksFetcher(network: SignalNetwork, fetchImpl: typeof fetch = fetch, timeoutMs: number = RULES.timeoutMs) {
  return async (path: string): Promise<unknown> => {
    const url = `${NEARBLOCKS_API[network]}${path}`;
    const hit = cache.get(url);
    const age = hit ? Date.now() - hit.at : Infinity;
    if (hit && hit.error === undefined && age < HIT_MS) return hit.value;
    if (hit && hit.error !== undefined && age < MISS_MS) throw new Error(hit.error);
    try {
      const key = typeof process !== "undefined" ? process.env?.NEARBLOCKS_API_KEY : undefined;
      const response = await fetchImpl(url, { headers: key ? { authorization: `Bearer ${key}` } : {}, signal: AbortSignal.timeout(timeoutMs) });
      if (!response.ok) throw new Error(`NearBlocks answered ${response.status}`);
      const value = await response.json();
      cache.set(url, { at: Date.now(), value });
      return value;
    } catch (error) {
      const message = error instanceof Error && error.name === "TimeoutError" ? `NearBlocks did not answer within ${timeoutMs} ms` : String((error as Error)?.message ?? error);
      cache.set(url, { at: Date.now(), error: message });
      throw new Error(message);
    }
  };
}

/** For tests: forget cached NearBlocks answers. */
export const clearSignalCache = () => cache.clear();

const enc = encodeURIComponent;
const iso = (ms: number) => new Date(ms).toISOString();
const nsToMs = (ns: unknown) => (typeof ns === "string" || typeof ns === "number" ? Math.floor(Number(ns) / 1e6) : NaN);
const unavailable = (id: SignalId, source: string, why: unknown): Signal => ({ id, status: "unavailable", points: 0, summary: `Unavailable: ${String((why as Error)?.message ?? why).slice(0, 160)}. It adds nothing to the score.`, source });

function ago(ms: number): string {
  const h = ms / 3_600_000;
  if (h < 1) return `${Math.max(1, Math.round(ms / 60_000))} minutes`;
  if (h < 48) return `${Math.round(h)} hours`;
  const d = h / 24;
  return d < 730 ? `${Math.round(d)} days` : `${Math.round(d / 365)} years`;
}

export async function reportedSignal(target: string, network: SignalNetwork, deps: Pick<SignalDeps, "reports">): Promise<Signal> {
  const registry = REPORTS_REGISTRY[network];
  if (!registry) return { id: "reported", status: "not_applicable", points: 0, summary: `The shared blocklist is not deployed on ${network}.`, source: "contracts/reports" };
  const source = `${registry} get_reports`;
  try {
    const active = (await deps.reports(registry, target)).filter((r) => r.retracted_at_ms === null || r.retracted_at_ms === undefined);
    if (!active.length) return { id: "reported", status: "clear", points: 0, summary: "No active report on the shared blocklist.", source };
    const reports = active.map((r) => ({ id: r.id, reporter: r.reporter, reason: r.reason, evidence_url: r.evidence_url, reported_at: iso(r.created_at_ms) }));
    const who = [...new Set(reports.map((r) => r.reporter))].join(", ");
    return {
      id: "reported",
      status: "found",
      points: RULES.reportedPoints,
      flag: SIGNAL_FLAGS.reported,
      summary: `Reported on the shared blocklist by ${who} (${reports.length === 1 ? "1 active report" : `${reports.length} active reports`}). Evidence: ${reports.map((r) => r.evidence_url).join(", ")}`,
      source,
      reports,
    };
  } catch (error) {
    return unavailable("reported", source, error);
  }
}

type NbAccount = { data?: { created?: { block_timestamp?: string; transaction_hash?: string } } | null };
type NbTxns = { data?: Array<{ transaction_hash: string; block_timestamp?: string; signer_account_id?: string; receiver_account_id?: string }> | null };
type NbDeploys = { data?: Array<{ transaction_hash: string; block?: { block_timestamp?: string }; predecessor_account_id?: string }> | null };

/** Creation time from NearBlocks; with it, whether the account has done anything since. */
export async function ageSignal(target: string, network: SignalNetwork, deps: Pick<SignalDeps, "nearblocks" | "now">, created: Promise<NbAccount>): Promise<Signal> {
  const source = `${NEARBLOCKS_WEB[network]}/address/${target}`;
  try {
    const account = await created;
    const at = nsToMs(account?.data?.created?.block_timestamp);
    if (!Number.isFinite(at) || at <= 0) {
      // Accounts from genesis have no creation transaction.
      return { id: "account_age", status: "unavailable", points: 0, summary: "NearBlocks has no creation time for this account (a genesis account, or not indexed yet). It adds nothing to the score.", source };
    }
    const age = deps.now() - at;
    if (age >= RULES.newAccountMs) return { id: "account_age", status: "clear", points: 0, summary: `Created ${ago(age)} ago (${iso(at)}).`, source };
    const txns = (await deps.nearblocks(`/v3/accounts/${enc(target)}/txns?limit=3`)) as NbTxns;
    const count = txns?.data?.length ?? 0;
    const creation = account?.data?.created?.transaction_hash;
    const activity = (txns?.data ?? []).filter((t) => t.transaction_hash !== creation).length;
    if (activity === 0) {
      return { id: "account_age", status: "found", points: RULES.newAndEmptyPoints, flag: SIGNAL_FLAGS.newAndEmpty, summary: `Created ${ago(age)} ago (${iso(at)}), and no transaction since its creation (${count} indexed).`, source };
    }
    return { id: "account_age", status: "found", points: RULES.newAccountPoints, flag: SIGNAL_FLAGS.new, summary: `Created ${ago(age)} ago (${iso(at)}), with ${activity}${count >= 3 ? "+" : ""} transaction${activity === 1 ? "" : "s"} since.`, source };
  } catch (error) {
    return unavailable("account_age", source, error);
  }
}

/** The last code deployment; the one in the account's own creation transaction does not count as a change. */
export async function codeSignal(target: string, network: SignalNetwork, facts: Facts, deps: Pick<SignalDeps, "nearblocks" | "now">, created: Promise<NbAccount>): Promise<Signal> {
  const source = `${NEARBLOCKS_WEB[network]}/address/${target}?tab=contract`;
  if (!facts.hasContract) return { id: "recent_code_change", status: "not_applicable", points: 0, summary: "No contract code on this account.", source };
  try {
    const [deploys, account] = await Promise.all([deps.nearblocks(`/v3/accounts/${enc(target)}/contract/deployments`) as Promise<NbDeploys>, created.catch(() => null)]);
    const rows = (deploys?.data ?? []).map((d) => ({ tx: d.transaction_hash, at: nsToMs(d.block?.block_timestamp) })).filter((d) => Number.isFinite(d.at));
    if (!rows.length) return { id: "recent_code_change", status: "unavailable", points: 0, summary: "NearBlocks lists no deployment for this contract (global code, or not indexed). It adds nothing to the score.", source };
    const creation = account?.data?.created?.transaction_hash;
    const latest = rows.reduce((a, b) => (b.at > a.at ? b : a));
    const changes = rows.filter((d) => d.tx !== creation);
    const recent = changes.filter((d) => deps.now() - d.at < RULES.recentCodeMs);
    if (recent.length) {
      const last = recent.reduce((a, b) => (b.at > a.at ? b : a));
      return { id: "recent_code_change", status: "found", points: RULES.recentCodePoints, flag: SIGNAL_FLAGS.recentCode, summary: `Its code was deployed ${ago(deps.now() - last.at)} ago (${iso(last.at)}, tx ${last.tx}), after the account was created.`, source };
    }
    if (!changes.length) return { id: "recent_code_change", status: "clear", points: 0, summary: `Its code was deployed only when the account was created (${iso(latest.at)}) and has not changed since.`, source };
    return { id: "recent_code_change", status: "clear", points: 0, summary: `Last code deployment ${ago(deps.now() - latest.at)} ago (${iso(latest.at)}), more than 7 days ago.`, source };
  } catch (error) {
    return unavailable("recent_code_change", source, error);
  }
}

/** Has `caller` dealt with `target` before: a transaction it signed to the target, or a token transfer between them. */
export async function interactionSignal(target: string, caller: string | undefined, network: SignalNetwork, deps: Pick<SignalDeps, "nearblocks">): Promise<Signal> {
  const source = caller ? `${NEARBLOCKS_WEB[network]}/address/${target}` : "no caller given";
  if (!caller) return { id: "prior_interactions", status: "not_applicable", points: 0, summary: "No paying account was given, so prior interactions were not looked up.", source };
  if (caller === target) return { id: "prior_interactions", status: "not_applicable", points: 0, summary: "The payer and the target are the same account.", source };
  try {
    const [direct, tokens] = (await Promise.all([
      deps.nearblocks(`/v3/accounts/${enc(target)}/txns?signer=${enc(caller)}&limit=1`),
      deps.nearblocks(`/v3/accounts/${enc(target)}/ft-txns?involved=${enc(caller)}&limit=1`),
    ])) as [NbTxns, NbTxns];
    const seen = [...(direct?.data ?? []), ...(tokens?.data ?? [])];
    if (!seen.length) return { id: "prior_interactions", status: "clear", points: 0, summary: `${caller} has not dealt with this account before (no transaction it signed to it, no token transfer between them). Informational: it does not change the score.`, source };
    const first = seen[0]!;
    return { id: "prior_interactions", status: "found", points: RULES.priorInteractionPoints, summary: `${caller} has dealt with this account before (for example tx ${first.transaction_hash}). Informational: it does not lower the score.`, source: `${NEARBLOCKS_WEB[network]}/txns/${first.transaction_hash}` };
  } catch (error) {
    return unavailable("prior_interactions", source, error);
  }
}

/**
 * Reads all four signals in parallel. Never throws: a source that fails gives an
 * "unavailable" signal. For an account that does not exist only the blocklist is read.
 */
export async function collectSignals(target: string, facts: Facts, { network, caller }: { network: SignalNetwork; caller?: string }, deps: SignalDeps): Promise<Signal[]> {
  const reported = reportedSignal(target, network, deps);
  if (!facts.exists) {
    const none = (id: SignalId): Signal => ({ id, status: "not_applicable", points: 0, summary: "The account does not exist.", source: `${NEARBLOCKS_WEB[network]}/address/${target}` });
    return [await reported, none("account_age"), none("recent_code_change"), none("prior_interactions")];
  }
  const created = deps.nearblocks(`/v3/accounts/${enc(target)}`) as Promise<NbAccount>;
  created.catch(() => undefined); // read by two signals; each handles the failure
  return Promise.all([reported, ageSignal(target, network, deps, created), codeSignal(target, network, facts, deps, created), interactionSignal(target, caller, network, deps)]);
}

/** One line per signal for a person or an agent: what was found, and where. */
export function describeSignals(signals: Signal[]): string[] {
  return signals.map((s) => `${s.id} [${s.status}${s.points ? `, +${s.points}` : ""}]: ${s.summary} (source: ${s.source})`);
}
