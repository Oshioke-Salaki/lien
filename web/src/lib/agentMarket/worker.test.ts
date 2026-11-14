import { describe, expect, it, vi } from "vitest";
import type { Facts } from "../risk";
import { deliver, handleEvent, jobFromRow, MARKET_URL, planFor, pollOnce, type AssignmentRow, type Deps } from "./worker";

const ID = "7d3b2c4e-1111-4000-8000-000000000001";
const funded: Facts = { exists: true, hasContract: false, fullAccessKeys: 1, functionCallKeys: 0, balanceNear: 10, storageBytes: 200 };

type Call = { url: string; method: string; auth: string | null; body: unknown };

/** A fake marketplace: records every call and answers from `routes` (path -> [status, json]). */
function market(routes: Record<string, [number, unknown]> = {}) {
  const calls: Call[] = [];
  const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    calls.push({ url, method: init?.method ?? "GET", auth: headers.get("authorization"), body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const path = url.slice(MARKET_URL.length);
    const [status, json] = routes[path] ?? [200, path.endsWith("/start") ? { startedAt: "2026-11-14T00:00:00Z" } : { ok: true }];
    return new Response(JSON.stringify(json), { status, headers: { "content-type": "application/json" } });
  });
  return { calls, fetch: fetch as unknown as typeof globalThis.fetch };
}

const deps = (m: ReturnType<typeof market>, facts: Facts = funded): Deps & { reads: string[] } => {
  const reads: string[] = [];
  return { token: "aat_test", fetch: m.fetch, reads, readFacts: async (id, network) => (reads.push(`${id}@${network}`), facts) };
};

describe("serving an Agent Market assignment", () => {
  it("reads the chain, starts, then submits the Markdown, with the bearer token", async () => {
    const m = market();
    const d = deps(m);
    const outcome = await deliver(d, { assignmentId: ID, texts: ["Risk check for alice.near please"] });
    expect(outcome).toMatchObject({ kind: "submitted", verdict: "ALLOW", target: { accountId: "alice.near", network: "mainnet" } });
    expect(d.reads).toEqual(["alice.near@mainnet"]);
    expect(m.calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      `POST ${MARKET_URL}/v1/assignments/${ID}/start`,
      `POST ${MARKET_URL}/v1/assignments/${ID}/submit`,
    ]);
    expect(m.calls.every((c) => c.auth === "Bearer aat_test")).toBe(true);
    const submitted = m.calls[1]!.body as { deliverableMarkdown: string };
    expect(Object.keys(submitted)).toEqual(["deliverableMarkdown"]);
    expect(submitted.deliverableMarkdown).toContain("# Sentinel risk check: `alice.near`");
  });

  it("declines a brief with no account, as `rejected`, and never reads the chain", async () => {
    const m = market();
    const d = deps(m);
    const outcome = await deliver(d, { assignmentId: ID, texts: ["Is my wallet safe?"] });
    expect(outcome.kind).toBe("declined");
    expect(d.reads).toEqual([]);
    expect(m.calls).toHaveLength(1);
    expect(m.calls[0]).toMatchObject({ method: "POST", url: `${MARKET_URL}/v1/assignments/${ID}/decline`, body: { reason: "rejected" } });
    expect((m.calls[0]!.body as { detail: string }).detail.length).toBeLessThanOrEqual(1000);
  });

  it("declines as `failed` once a version was delivered, since `rejected` is refused then", async () => {
    const m = market();
    await deliver(deps(m), { assignmentId: ID, texts: ["thanks"], delivered: true });
    expect(m.calls[0]!.body).toMatchObject({ reason: "failed" });
  });

  it("leaves the assignment untouched when the chain cannot be read", async () => {
    const m = market();
    const d: Deps = { token: "t", fetch: m.fetch, readFacts: async () => { throw new Error("all nodes down"); } };
    expect(await deliver(d, { assignmentId: ID, texts: ["bob.testnet"] })).toMatchObject({ kind: "error", error: "all nodes down" });
    expect(m.calls).toHaveLength(0);
  });

  it("does not submit when start is refused, and reports the marketplace's answer", async () => {
    const m = market({ [`/v1/assignments/${ID}/start`]: [400, { error: "invalid_state_transition" }] });
    const outcome = await deliver(deps(m), { assignmentId: ID, texts: ["bob.testnet"] });
    expect(outcome.kind).toBe("error");
    expect(outcome.kind === "error" && outcome.error).toContain("400");
    expect(m.calls).toHaveLength(1);
  });
});

describe("webhook events", () => {
  it("serves hire.created straight from its title and description", async () => {
    const m = market();
    const d = deps(m);
    const outcome = await handleEvent(d, { event: "hire.created", assignment_id: ID, title: "Sentinel check", description: "Account: carol.testnet" });
    expect(outcome).toMatchObject({ kind: "submitted", target: { accountId: "carol.testnet", network: "testnet" } });
  });

  it("ignores pings, outcomes and events without a valid assignment id", () => {
    expect(planFor({ event: "webhook.ping" })).toEqual({ kind: "none" });
    expect(planFor({ event: "hire.accepted", assignment_id: ID })).toEqual({ kind: "none" });
    expect(planFor({ event: "hire.refunded", assignment_id: ID })).toEqual({ kind: "none" });
    expect(planFor({ event: "hire.created", assignment_id: "../../v1/agents/me" })).toEqual({ kind: "none" });
    expect(planFor({ event: "hire.dispute_resolved", assignment_id: ID, ruling: "worker_wins" })).toEqual({ kind: "none" });
    expect(planFor({ event: "hire.dispute_resolved", assignment_id: ID, ruling: "redo" })).toEqual({ kind: "reread", assignmentId: ID });
  });

  it("re-reads a request for changes and serves the account the buyer's feedback names", async () => {
    const row: AssignmentRow = {
      assignment: { assignmentId: ID, status: "in_progress", deliverableUrl: "key", submittedAt: "2026-11-14T00:00:00Z" },
      job: { jobId: "j", title: "Check alice.near", description: "" },
      latestMessage: { senderSide: "buyer", body: "Wrong one, I meant dan.testnet" },
    };
    const m = market({ "/v1/agents/me/assignments?status=in_progress&limit=50": [200, { assignments: [row] }] });
    const outcome = await handleEvent(deps(m), { event: "hire.changes_requested", assignment_id: ID });
    expect(outcome).toMatchObject({ kind: "submitted", target: { accountId: "dan.testnet" } });
  });
});

describe("the fallback poller", () => {
  const row = (id: string, over: Partial<AssignmentRow> = {}): AssignmentRow => ({
    assignment: { assignmentId: id, status: "in_progress", deliverableUrl: null, submittedAt: null },
    job: { jobId: "j", title: "Risk check", description: `please check ${id.slice(-1)}x.near`, jobKind: "standard" },
    latestMessage: null,
    ...over,
  });

  it("serves every in_progress hire and skips competition entries", async () => {
    const a = "7d3b2c4e-1111-4000-8000-00000000000a";
    const b = "7d3b2c4e-1111-4000-8000-00000000000b";
    const c = "7d3b2c4e-1111-4000-8000-00000000000c";
    const comp = row(c, { job: { jobId: "j", title: "Contest", description: "x.near", jobKind: "competition" } });
    const m = market({ "/v1/agents/me/assignments?status=in_progress&limit=50": [200, { assignments: [row(a), row(b), comp] }] });
    const outcomes = await pollOnce(deps(m));
    expect(outcomes.map((o) => o.kind)).toEqual(["submitted", "submitted"]);
    expect(m.calls[0]).toMatchObject({ method: "GET", auth: "Bearer aat_test" });
    expect(m.calls.filter((call) => call.url.endsWith("/submit")).map((call) => call.url)).toEqual([
      `${MARKET_URL}/v1/assignments/${a}/submit`,
      `${MARKET_URL}/v1/assignments/${b}/submit`,
    ]);
  });

  it("reads a row's brief with the buyer's newest message first", () => {
    const job = jobFromRow(row(ID, { latestMessage: { senderSide: "buyer", body: "use erin.near" } }));
    expect(job?.texts[0]).toBe("use erin.near");
    expect(jobFromRow(row(ID, { latestMessage: { senderSide: "worker", body: "on it" } }))?.texts[0]).toBeNull();
  });
});
