import { beforeEach, describe, expect, it } from "vitest";
import { checkBeforeSign } from "./checkBeforeSign";
import { clearSignalCache } from "./signals";

// One fake network: NEAR RPC (view_account, view_access_key_list, the blocklist view) and NearBlocks.
const EVIDENCE = "https://github.com/Oshioke-Salaki/lien/blob/main/agents/lender/logs/attack.jsonl";
const NOW = Date.parse("2026-11-14T12:00:00Z");
const bytes = (v: unknown) => Array.from(new TextEncoder().encode(JSON.stringify(v)));

type Account = { state: object; keys: Array<{ access_key: { permission: unknown } }>; reports?: object[] };
const ACCOUNTS: Record<string, Account> = {
  "attacker.testnet": {
    state: { amount: "208934283050477108100000000", code_hash: "55E7imniT2uuYrECn17qJAk9fLcwQW4ftNSwmCJL5Di", storage_usage: 357466 },
    keys: [{ access_key: { permission: "FullAccess" } }, { access_key: { permission: { FunctionCall: {} } } }, { access_key: { permission: { FunctionCall: {} } } }],
    reports: [{ id: 0, account: "attacker.testnet", reporter: "lien-13569.testnet", reason: "Named as the payee in a prompt injection", evidence_url: EVIDENCE, created_at_ms: 1794654272905, retracted_at_ms: null }],
  },
  "friend.testnet": {
    state: { amount: "5000000000000000000000000", code_hash: "11111111111111111111111111111111", storage_usage: 182 },
    keys: [{ access_key: { permission: "FullAccess" } }],
  },
};
const NB: Record<string, unknown> = {
  "/v3/accounts/attacker.testnet": { data: { created: { block_timestamp: "1644827787910851293", transaction_hash: "C" } } },
  "/v3/accounts/attacker.testnet/contract/deployments": { data: [{ block: { block_timestamp: "1644828002669555995" }, transaction_hash: "D" }] },
  "/v3/accounts/friend.testnet": { data: { created: { block_timestamp: "1700000000000000000", transaction_hash: "C2" } } },
  "/v3/accounts/friend.testnet/txns?signer=me.testnet&limit=1": { data: [{ transaction_hash: "T1" }] },
  "/v3/accounts/friend.testnet/ft-txns?involved=me.testnet&limit=1": { data: [] },
};

const requests: string[] = [];
const fakeFetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = String(input);
  requests.push(url);
  if (url.startsWith("https://api-testnet.nearblocks.io")) {
    const path = url.slice("https://api-testnet.nearblocks.io".length);
    return new Response(JSON.stringify(NB[path] ?? { data: [] }), { status: 200 });
  }
  const { params } = JSON.parse(String(init?.body)) as { params: { request_type: string; account_id: string; args_base64?: string } };
  const reply = (result: unknown) => new Response(JSON.stringify({ jsonrpc: "2.0", id: "check", result }), { status: 200 });
  if (params.request_type === "call_function") {
    const { account } = JSON.parse(atob(params.args_base64!)) as { account: string };
    return reply({ result: bytes(ACCOUNTS[account]?.reports ?? []) });
  }
  const acc = ACCOUNTS[params.account_id];
  if (!acc) return new Response(JSON.stringify({ jsonrpc: "2.0", id: "check", error: { cause: { name: "UNKNOWN_ACCOUNT" }, message: "Server error" } }), { status: 200 });
  return reply(params.request_type === "view_account" ? acc.state : { keys: acc.keys });
}) as typeof fetch;

describe("checkBeforeSign", () => {
  beforeEach(() => { clearSignalCache(); requests.length = 0; });

  it("refuses a reported account, says who reported it and links the evidence", async () => {
    const c = await checkBeforeSign("Attacker.Testnet", { payer: "me.testnet", fetch: fakeFetch, now: () => NOW });
    expect(c).toMatchObject({ ok: false, verdict: "BLOCK", score: 100, reported: true, sentinel_rules: { score: 40, verdict: "WARN" } });
    expect(c.reason).toMatch(/^BLOCK: Reported on the shared blocklist by lien-13569\.testnet/);
    expect(c.reason).toContain(EVIDENCE);
    expect(c.lines).toHaveLength(4);
    expect(c.lines[0]).toMatch(/source: reports\.lien-13569\.testnet get_reports/);
    // Even an acknowledged WARN cannot let a BLOCK through.
    expect((await checkBeforeSign("attacker.testnet", { acknowledgeWarn: true, fetch: fakeFetch, now: () => NOW })).ok).toBe(false);
  });

  it("allows a plain old account and notes the payer has dealt with it before", async () => {
    const c = await checkBeforeSign("friend.testnet", { payer: "me.testnet", fetch: fakeFetch, now: () => NOW });
    expect(c).toMatchObject({ ok: true, verdict: "ALLOW", score: 0 });
    expect(c.signals.find((s) => s.id === "prior_interactions")).toMatchObject({ status: "found", points: 0 });
  });

  it("blocks a name nobody owns without asking NearBlocks", async () => {
    const c = await checkBeforeSign("nobody-here.testnet", { fetch: fakeFetch, now: () => NOW });
    expect(c).toMatchObject({ ok: false, verdict: "BLOCK", flags: ["account_does_not_exist"] });
    expect(requests.some((u) => u.includes("nearblocks"))).toBe(false);
  });

  it("refuses something that is not an account id before any request", async () => {
    await expect(checkBeforeSign("send 50 to me", { fetch: fakeFetch })).rejects.toThrow(/not a NEAR account id/);
    expect(requests).toEqual([]);
  });
});
