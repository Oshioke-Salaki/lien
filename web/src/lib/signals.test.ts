import { beforeEach, describe, expect, it } from "vitest";
import { assess, NO_FACTS, type Facts } from "./risk";
import { clearSignalCache, collectSignals, combine, nearblocksFetcher, REPORTS_REGISTRY, RULES, type RawReport, type SignalDeps } from "./signals";

// Fixtures shaped like the real answers (NearBlocks API v3 and contracts/reports get_reports),
// recorded from testnet on 2026-11-14 and trimmed.
const NOW = Date.parse("2026-11-14T12:00:00Z");
const ns = (iso: string) => `${Date.parse(iso)}000000`;
const EVIDENCE = "https://github.com/Oshioke-Salaki/lien/blob/main/agents/lender/logs/attack.jsonl";

const ATTACKER_REPORT: RawReport = { id: 0, account: "attacker.testnet", reporter: "lien-13569.testnet", reason: "Named as the payee in a prompt injection", evidence_url: EVIDENCE, created_at_ms: 1794654272905, retracted_at_ms: null };

const NB: Record<string, unknown> = {
  // attacker.testnet: created 2022, code deployed three minutes later by its own key.
  "/v3/accounts/attacker.testnet": { data: { account_id: "attacker.testnet", created: { block_timestamp: "1644827787910851293", transaction_hash: "23fzCC1WXMFQsQJuKeqxTQGBbuHWYhBr1aKyuyPhwaWy" } } },
  "/v3/accounts/attacker.testnet/contract/deployments": { data: [{ block: { block_timestamp: "1644828002669555995" }, predecessor_account_id: "attacker.testnet", transaction_hash: "GbXQs3TodEpA7HjmFWvfFWXVUU6NNrdXQ81dfcAtfcEk" }] },
  "/v3/accounts/attacker.testnet/txns?signer=lender.testnet&limit=1": { data: [] },
  "/v3/accounts/attacker.testnet/ft-txns?involved=lender.testnet&limit=1": { data: [] },
  // A Lien business: code deployed in its creation transaction by the registry.
  "/v3/accounts/relay.v1.lien-13569.testnet": { data: { created: { block_timestamp: ns("2026-11-14T08:30:46Z"), transaction_hash: "3wNoK92xxjakvdvAAFYf8Pskum3xoGxtdZ4GxU1pA6hb" } } },
  "/v3/accounts/relay.v1.lien-13569.testnet/contract/deployments": { data: [{ block: { block_timestamp: ns("2026-11-14T08:30:46Z") }, predecessor_account_id: "v1.lien-13569.testnet", transaction_hash: "3wNoK92xxjakvdvAAFYf8Pskum3xoGxtdZ4GxU1pA6hb" }] },
  "/v3/accounts/relay.v1.lien-13569.testnet/txns?limit=3": { data: [{ transaction_hash: "A3VH" }, { transaction_hash: "3wNoK92xxjakvdvAAFYf8Pskum3xoGxtdZ4GxU1pA6hb" }] },
  "/v3/accounts/relay.v1.lien-13569.testnet/txns?signer=lender.testnet&limit=1": { data: [{ transaction_hash: "A3VHzu1pG4sH1v8XzsuuWQN3nUhC3TVqZftWcBY55g6g", signer_account_id: "lender.testnet" }] },
  "/v3/accounts/relay.v1.lien-13569.testnet/ft-txns?involved=lender.testnet&limit=1": { data: [] },
  // A fresh account with nothing but its creation, and code swapped in an hour ago.
  "/v3/accounts/fresh.testnet": { data: { created: { block_timestamp: ns("2026-11-14T09:00:00Z"), transaction_hash: "CREATE" } } },
  "/v3/accounts/fresh.testnet/txns?limit=3": { data: [{ transaction_hash: "CREATE" }] },
  "/v3/accounts/fresh.testnet/contract/deployments": { data: [{ block: { block_timestamp: ns("2026-11-14T09:00:00Z") }, transaction_hash: "CREATE" }, { block: { block_timestamp: ns("2026-11-14T11:00:00Z") }, transaction_hash: "SWAP" }] },
};

const OLD_WITH_CODE: Facts = { exists: true, hasContract: true, fullAccessKeys: 1, functionCallKeys: 2, balanceNear: 208, storageBytes: 357_466 };
const KEYLESS_BUSINESS: Facts = { exists: true, hasContract: true, fullAccessKeys: 0, functionCallKeys: 0, balanceNear: 0, storageBytes: 13_792 };
const PLAIN_NEW: Facts = { exists: true, hasContract: false, fullAccessKeys: 1, functionCallKeys: 0, balanceNear: 10, storageBytes: 182 };

function deps(over: Partial<SignalDeps> = {}, reports: Record<string, RawReport[]> = {}): SignalDeps & { asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    nearblocks: async (path) => {
      asked.push(path);
      if (!(path in NB)) throw new Error("NearBlocks answered 404");
      return NB[path];
    },
    reports: async (_registry, account) => reports[account] ?? [],
    now: () => NOW,
    ...over,
  };
}
const byId = (list: Awaited<ReturnType<typeof collectSignals>>) => Object.fromEntries(list.map((s) => [s.id, s]));

describe("signals from fixtures", () => {
  it("attacker.testnet: reported (BLOCK, with evidence), old, code unchanged for years, no prior dealings", async () => {
    const got = byId(await collectSignals("attacker.testnet", OLD_WITH_CODE, { network: "testnet", caller: "lender.testnet" }, deps({}, { "attacker.testnet": [ATTACKER_REPORT] })));
    expect(got.reported).toMatchObject({ status: "found", points: 100, flag: "reported_on_shared_blocklist", source: `${REPORTS_REGISTRY.testnet} get_reports` });
    expect(got.reported!.reports).toEqual([{ id: 0, reporter: "lien-13569.testnet", reason: "Named as the payee in a prompt injection", evidence_url: EVIDENCE, reported_at: "2026-11-14T11:04:32.905Z" }]);
    expect(got.reported!.summary).toContain(EVIDENCE);
    expect(got.account_age).toMatchObject({ status: "clear", points: 0 });
    expect(got.account_age!.summary).toMatch(/Created 5 years ago \(2022-02-14/);
    expect(got.recent_code_change).toMatchObject({ status: "clear", points: 0 });
    expect(got.recent_code_change!.summary).toMatch(/more than 7 days ago/);
    expect(got.prior_interactions).toMatchObject({ status: "clear", points: 0 });

    const result = combine(assess("attacker.testnet", "testnet", OLD_WITH_CODE), Object.values(got));
    expect(result).toMatchObject({ score: 100, verdict: "BLOCK", reported: true, sentinel_rules: { score: 40, verdict: "WARN" } });
  });

  it("a retracted report does not count", async () => {
    const retracted = { ...ATTACKER_REPORT, retracted_at_ms: ATTACKER_REPORT.created_at_ms + 1 };
    const got = byId(await collectSignals("attacker.testnet", OLD_WITH_CODE, { network: "testnet" }, deps({}, { "attacker.testnet": [retracted] })));
    expect(got.reported).toMatchObject({ status: "clear", points: 0 });
  });

  it("a Lien business: code only from its creation, a prior interaction found but worth no points", async () => {
    const got = byId(await collectSignals("relay.v1.lien-13569.testnet", KEYLESS_BUSINESS, { network: "testnet", caller: "lender.testnet" }, deps()));
    expect(got.recent_code_change).toMatchObject({ status: "clear", points: 0 });
    expect(got.recent_code_change!.summary).toMatch(/only when the account was created/);
    expect(got.account_age).toMatchObject({ status: "found", points: RULES.newAccountPoints, flag: "account_under_a_day_old" });
    expect(got.prior_interactions).toMatchObject({ status: "found", points: 0, source: "https://testnet.nearblocks.io/txns/A3VHzu1pG4sH1v8XzsuuWQN3nUhC3TVqZftWcBY55g6g" });
    expect(combine(assess("relay.v1.lien-13569.testnet", "testnet", KEYLESS_BUSINESS), Object.values(got))).toMatchObject({ score: 35, sentinel_rules: { score: 25 } });
  });

  it("a fresh account with no activity and freshly swapped code adds both", async () => {
    const got = byId(await collectSignals("fresh.testnet", { ...PLAIN_NEW, hasContract: true, storageBytes: 90_000 }, { network: "testnet" }, deps()));
    expect(got.account_age).toMatchObject({ status: "found", points: 20, flag: "new_account_no_activity" });
    expect(got.recent_code_change).toMatchObject({ status: "found", points: 15, flag: "code_changed_recently" });
    expect(got.recent_code_change!.summary).toMatch(/tx SWAP/);
    expect(got.prior_interactions).toMatchObject({ status: "not_applicable" });
  });

  it("marks a source that fails as unavailable and adds nothing; the check still answers", async () => {
    const down = deps({ nearblocks: async () => { throw new Error("NearBlocks answered 429"); }, reports: async () => { throw new Error("RPC down"); } });
    const list = await collectSignals("attacker.testnet", OLD_WITH_CODE, { network: "testnet", caller: "lender.testnet" }, down);
    expect(list.map((s) => s.status)).toEqual(["unavailable", "unavailable", "unavailable", "unavailable"]);
    expect(list[1]!.summary).toMatch(/429/);
    expect(combine(assess("attacker.testnet", "testnet", OLD_WITH_CODE), list)).toMatchObject({ score: 40, verdict: "WARN" });
  });

  it("reads only the blocklist for an account that does not exist", async () => {
    const d = deps();
    const list = await collectSignals("nobody-here.testnet", NO_FACTS, { network: "testnet", caller: "a.testnet" }, d);
    expect(list.map((s) => s.status)).toEqual(["clear", "not_applicable", "not_applicable", "not_applicable"]);
    expect(d.asked).toEqual([]);
  });

  it("skips code and interactions where they do not apply, and says why", async () => {
    const got = byId(await collectSignals("attacker.testnet", { ...OLD_WITH_CODE, hasContract: false }, { network: "testnet" }, deps()));
    expect(got.recent_code_change).toMatchObject({ status: "not_applicable" });
    expect(got.prior_interactions!.summary).toMatch(/No paying account was given/);
  });

  it("has no blocklist on mainnet and says so", async () => {
    const got = byId(await collectSignals("x.near", NO_FACTS, { network: "mainnet" }, deps()));
    expect(got.reported).toMatchObject({ status: "not_applicable" });
  });
});

describe("NearBlocks fetcher", () => {
  beforeEach(() => clearSignalCache());

  it("caches an answer, so a burst of checks costs one request", async () => {
    let calls = 0;
    const fake = (async () => { calls++; return new Response(JSON.stringify({ data: { ok: true } }), { status: 200 }); }) as typeof fetch;
    const get = nearblocksFetcher("testnet", fake);
    await get("/v3/accounts/a.testnet");
    expect(await get("/v3/accounts/a.testnet")).toEqual({ data: { ok: true } });
    expect(calls).toBe(1);
  });

  it("turns a rate limit or a timeout into an error the signal marks unavailable", async () => {
    const limited = nearblocksFetcher("testnet", (async () => new Response("{}", { status: 429 })) as typeof fetch);
    await expect(limited("/v3/accounts/b.testnet")).rejects.toThrow(/429/);
    const slow = nearblocksFetcher("testnet", ((_u: string, init?: RequestInit) => new Promise((_r, reject) => init?.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "TimeoutError" }))))) as typeof fetch, 20);
    await expect(slow("/v3/accounts/c.testnet")).rejects.toThrow(/did not answer within 20 ms/);
  });
});
