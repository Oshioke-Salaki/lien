// checkBeforeSign: one call any NEAR agent can make before it signs a payment.
//
//   import { checkBeforeSign } from "./checkBeforeSign";
//   const c = await checkBeforeSign("attacker.testnet", { payer: "my-agent.testnet" });
//   if (!c.ok) throw new Error(c.reason);   // BLOCK, or WARN without acknowledgeWarn
//
// It runs Lien's extended check (lib/signals.ts): Sentinel's deterministic rules on the
// account's keys and code (lib/risk.ts), plus the shared blocklist, account age, recent code
// changes and prior interactions with the payer. It reads public data only (NEAR RPC and
// NearBlocks), needs no key and sends nothing. Its only imports are risk.ts and signals.ts,
// which have no framework dependencies, so the three files can be copied into any agent.
// Over MCP the same check is the free `check_account` tool (with an optional `payer`).

import { assess, NO_FACTS, parseFacts, VERDICT_TEXT, type Facts } from "./risk";
import { collectSignals, combine, describeSignals, nearblocksFetcher, type ExtendedCheck, type RawReport, type SignalDeps, type SignalNetwork } from "./signals";

export type CheckOptions = {
  /** The account that would pay. Enables the prior-interactions signal. */
  payer?: string;
  network?: SignalNetwork;
  /** Pass a WARN as ok (the caller accepts the flags). A BLOCK is never ok. */
  acknowledgeWarn?: boolean;
  /** A NEAR RPC endpoint. Default: FastNEAR's public endpoint for the network. */
  rpcUrl?: string;
  fetch?: typeof fetch;
  now?: () => number;
};

export type CheckBeforeSign = ExtendedCheck & {
  /** True only for ALLOW, or for WARN with acknowledgeWarn. */
  ok: boolean;
  meaning: string;
  reason: string;
  /** One line per signal, with its source. */
  lines: string[];
};

const DEFAULT_RPC: Record<SignalNetwork, string> = { testnet: "https://rpc.testnet.fastnear.com", mainnet: "https://free.rpc.fastnear.com" };
const ACCOUNT = /^(?=.{2,64}$)(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;

function rpcClient(url: string, fetchImpl: typeof fetch) {
  return async <T>(params: object): Promise<T> => {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: "check", method: "query", params: { finality: "final", ...params } }),
      signal: AbortSignal.timeout(8_000),
    });
    const body = (await response.json()) as { result?: T & { error?: string }; error?: { cause?: { name?: string }; message?: string } };
    if (body.error) throw new Error(body.error.cause?.name ?? body.error.message ?? "RPC error");
    if (body.result?.error) throw new Error(body.result.error);
    return body.result as T;
  };
}

async function readFacts(rpc: ReturnType<typeof rpcClient>, id: string): Promise<Facts> {
  let state;
  try {
    state = await rpc<Parameters<typeof parseFacts>[0]>({ request_type: "view_account", account_id: id });
  } catch (error) {
    if (/UNKNOWN_ACCOUNT|does not exist/i.test(String((error as Error).message))) return NO_FACTS;
    throw error;
  }
  const keys = await rpc<Parameters<typeof parseFacts>[1]>({ request_type: "view_access_key_list", account_id: id });
  return parseFacts(state, keys);
}

export async function checkBeforeSign(target: string, options: CheckOptions = {}): Promise<CheckBeforeSign> {
  const id = target.trim().toLowerCase();
  if (!ACCOUNT.test(id)) throw new Error(`${target} is not a NEAR account id`);
  const network = options.network ?? (id.endsWith(".near") ? "mainnet" : "testnet");
  const fetchImpl = options.fetch ?? fetch;
  const rpc = rpcClient(options.rpcUrl ?? DEFAULT_RPC[network], fetchImpl);
  const deps: SignalDeps = {
    nearblocks: nearblocksFetcher(network, fetchImpl),
    reports: async (registry, account) => {
      const out = await rpc<{ result: number[] }>({ request_type: "call_function", account_id: registry, method_name: "get_reports", args_base64: btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify({ account })))) });
      return JSON.parse(new TextDecoder().decode(new Uint8Array(out.result))) as RawReport[];
    },
    now: options.now ?? Date.now,
  };
  const facts = await readFacts(rpc, id);
  const signals = await collectSignals(id, facts, { network, caller: options.payer?.trim().toLowerCase() || undefined }, deps);
  const result = combine(assess(id, network, facts), signals);
  const ok = result.verdict === "ALLOW" || (result.verdict === "WARN" && options.acknowledgeWarn === true);
  const reported = signals.find((s) => s.id === "reported" && s.status === "found");
  const reason = reported
    ? `BLOCK: ${reported.summary}`
    : `${result.verdict}: ${CHECKED(result)}${result.flags.length ? ` Flags: ${result.flags.join(", ")}.` : ""}`;
  return { ...result, ok, meaning: VERDICT_TEXT[result.verdict], reason, lines: describeSignals(signals) };
}

const CHECKED = (r: ExtendedCheck) => `Lien's extended check scores ${r.target} at ${r.score} of 100 (Sentinel's rules alone: ${r.sentinel_rules.score}).`;
