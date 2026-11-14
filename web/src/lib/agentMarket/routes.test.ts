// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sign } from "./signature";

// The two routes, called as Next would call them, with after() captured instead of run.
const scheduled: Array<() => Promise<void>> = [];
vi.mock("next/server", async (original) => ({
  ...(await original<typeof import("next/server")>()),
  after: (task: () => Promise<void>) => void scheduled.push(task),
}));

const { POST } = await import("../../app/api/agent-market/webhook/route");
const { GET } = await import("../../app/api/agent-market/poll/route");

const SECRET = "whsec_route_test_0123456789abcdef0123456789";
const ID = "7d3b2c4e-1111-4000-8000-000000000001";

function signed(body: string, { secret = SECRET, timestamp = String(Math.floor(Date.now() / 1000)) } = {}) {
  return new Request("https://lien.test/api/agent-market/webhook", {
    method: "POST",
    headers: { "content-type": "application/json", "x-market-timestamp": timestamp, "x-market-signature": sign(secret, timestamp, body) },
    body,
  });
}

beforeEach(() => {
  scheduled.length = 0;
  vi.stubEnv("AGENT_MARKET_WEBHOOK_SECRET", SECRET);
  vi.stubEnv("AGENT_MARKET_TOKEN", "aat_test");
  vi.stubEnv("CRON_SECRET", "cron_test");
});
afterEach(() => vi.unstubAllEnvs());

describe("POST /api/agent-market/webhook", () => {
  it("answers 401 to a wrong secret, a stale timestamp, no headers, or no configured secret", async () => {
    const body = JSON.stringify({ event: "webhook.ping" });
    expect((await POST(signed(body, { secret: "not-the-secret-not-the-secret-123" }))).status).toBe(401);
    expect((await POST(signed(body, { timestamp: "1000" }))).status).toBe(401);
    expect((await POST(new Request("https://lien.test/x", { method: "POST", body }))).status).toBe(401);
    vi.stubEnv("AGENT_MARKET_WEBHOOK_SECRET", "");
    expect((await POST(signed(body))).status).toBe(401);
  });

  it("answers 200 to a signed ping and schedules nothing", async () => {
    const response = await POST(signed(JSON.stringify({ event: "webhook.ping", agent_id: "a", delivery_id: "test-1", test: true })));
    expect(response.status).toBe(200);
    expect(scheduled).toHaveLength(0);
  });

  it("answers 200 to hire.created at once and leaves the job to after()", async () => {
    const body = JSON.stringify({ event: "hire.created", assignment_id: ID, title: "Check", description: "alice.near" });
    const response = await POST(signed(body));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, event: "hire.created" });
    expect(scheduled).toHaveLength(1);

    // Then the scheduled job reads mainnet and delivers, with the RPC and the marketplace faked.
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith("https://market.near.ai")) {
        calls.push(`${init?.method} ${url}`);
        return new Response(JSON.stringify({ startedAt: "2026-11-14T00:00:00Z" }), { status: 200 });
      }
      const { params } = JSON.parse(String(init?.body)) as { params: { request_type: string } };
      calls.push(`rpc ${params.request_type} ${url}`);
      const result = params.request_type === "view_account"
        ? { amount: "5000000000000000000000000", code_hash: "11111111111111111111111111111111", storage_usage: 300 }
        : { keys: [{ access_key: { permission: "FullAccess" } }] };
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: "lien", result }), { status: 200 });
    }));
    await scheduled[0]!();
    vi.unstubAllGlobals();
    expect(calls).toHaveLength(4);
    expect(calls.slice(0, 2).every((c) => c.startsWith("rpc ") && /fastnear\.com|intea\.rs|drpc\.org|zan\.top/.test(c) && !/testnet/.test(c))).toBe(true);
    expect(calls.slice(2)).toEqual([`POST https://market.near.ai/v1/assignments/${ID}/start`, `POST https://market.near.ai/v1/assignments/${ID}/submit`]);
  });
});

describe("GET /api/agent-market/poll", () => {
  it("needs the CRON_SECRET bearer", async () => {
    const at = (auth?: string) => new Request("https://lien.test/api/agent-market/poll", { headers: auth ? { authorization: auth } : {} });
    expect((await GET(at())).status).toBe(401);
    expect((await GET(at("Bearer wrong"))).status).toBe(401);
    expect((await GET(at("cron_test"))).status).toBe(401);
    vi.stubEnv("CRON_SECRET", "");
    expect((await GET(at("Bearer "))).status).toBe(401);
  });

  it("serves the marketplace's in_progress list when authorized", async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ assignments: [] }), { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    const response = await GET(new Request("https://lien.test/api/agent-market/poll", { headers: { authorization: "Bearer cron_test" } }));
    vi.unstubAllGlobals();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ served: 0, outcomes: [] });
    expect(String((fetch.mock.calls[0] as unknown[])[0])).toBe("https://market.near.ai/v1/agents/me/assignments?status=in_progress&limit=50");
  });
});
