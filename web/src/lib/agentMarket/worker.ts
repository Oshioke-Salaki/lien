// Sentinel as a worker on NEAR's Agent Market (https://market.near.ai).
//
// Sources, all on market.near.ai:
//   /skill                            the golden path: start, then submit deliverableMarkdown
//   /skill/flows/worker-lifecycle.md  reading GET /v1/agents/me/assignments rows
//   /skill/reference/webhooks.md      events and their bodies (hire.created and friends)
//   /openapi.json                     MyAssignmentItem, SubmitRequest, DeclineAssignmentRequest
//
// A job is: find the account in the brief, read its chain facts, run Sentinel's rules,
// `POST /v1/assignments/{id}/start`, then `POST /v1/assignments/{id}/submit`. A brief with
// no account is declined (`rejected`, refunding the buyer) with a note asking for one:
// submitting a "please send an account" page would bill an A2A caller, whose submit is
// accepted at once, for nothing.

import type { Network } from "../config";
import { assess, type Facts } from "../risk";
import { parseBriefs, type Target } from "./brief";
import { NO_ACCOUNT_DETAIL, renderDeliverable } from "./deliverable";

export const MARKET_URL = "https://market.near.ai";
const HTTP_TIMEOUT_MS = 15_000;

export type Deps = {
  token: string;
  fetch?: typeof fetch;
  readFacts: (accountId: string, network: Network) => Promise<Facts>;
  log?: (message: string) => void;
};

/** One job to serve: the assignment and the text the account is looked for in, newest first. */
export type Job = {
  assignmentId: string;
  texts: Array<string | null | undefined>;
  /** True once a version was delivered (deliverableUrl set): the decline reason must then be `failed`. */
  delivered?: boolean;
};

export type Outcome =
  | { kind: "submitted"; assignmentId: string; target: Target; verdict: string }
  | { kind: "declined"; assignmentId: string }
  | { kind: "error"; assignmentId: string; error: string };

export class MarketError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

async function call<T>(deps: Deps, method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  const response = await (deps.fetch ?? fetch)(`${MARKET_URL}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${deps.token}`,
      accept: "application/json",
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    cache: "no-store",
  });
  const text = await response.text();
  if (!response.ok) throw new MarketError(response.status, `${method} ${path} answered ${response.status}: ${text.slice(0, 300)}`);
  return (text ? JSON.parse(text) : null) as T;
}

const assignmentPath = (id: string) => `/v1/assignments/${encodeURIComponent(id)}`;

export const startAssignment = (deps: Deps, id: string) => call<{ startedAt: string }>(deps, "POST", `${assignmentPath(id)}/start`);
export const submitAssignment = (deps: Deps, id: string, deliverableMarkdown: string) =>
  call<unknown>(deps, "POST", `${assignmentPath(id)}/submit`, { deliverableMarkdown });
export const declineAssignment = (deps: Deps, id: string, reason: "rejected" | "failed", detail: string) =>
  call<unknown>(deps, "POST", `${assignmentPath(id)}/decline`, { reason, detail });

/** Serves one assignment end to end. Never throws: the outcome says what happened. */
export async function deliver(deps: Deps, job: Job): Promise<Outcome> {
  const { assignmentId } = job;
  const log = deps.log ?? (() => {});
  try {
    const target = parseBriefs(...job.texts);
    if (!target) {
      await declineAssignment(deps, assignmentId, job.delivered ? "failed" : "rejected", NO_ACCOUNT_DETAIL);
      log(`agent-market: declined ${assignmentId}, no account in the brief`);
      return { kind: "declined", assignmentId };
    }
    // Read first: a chain read that fails leaves the assignment untouched for the poller to retry.
    const facts = await deps.readFacts(target.accountId, target.network);
    const assessment = assess(target.accountId, target.network, facts);
    const markdown = renderDeliverable({ ...target, facts, assessment });
    await startAssignment(deps, assignmentId);
    await submitAssignment(deps, assignmentId, markdown);
    log(`agent-market: submitted ${assignmentId}: ${target.accountId} on ${target.network} is ${assessment.verdict}`);
    return { kind: "submitted", assignmentId, target, verdict: assessment.verdict };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log(`agent-market: ${assignmentId} not delivered: ${message}`);
    return { kind: "error", assignmentId, error: message };
  }
}

// --- the pull side: GET /v1/agents/me/assignments (openapi MyAssignmentsResponse) ---

export type AssignmentRow = {
  assignment: { assignmentId: string; status: string; deliverableUrl?: string | null; submittedAt?: string | null };
  job: { jobId: string; title: string; description: string; jobKind?: string };
  latestMessage?: { senderSide: string; body: string } | null;
};

export const listInProgress = async (deps: Deps) =>
  (await call<{ assignments: AssignmentRow[] }>(deps, "GET", "/v1/agents/me/assignments?status=in_progress&limit=50")).assignments ?? [];

/** The job a row asks for; null for rows that are not Sentinel's to serve (competitions, finished work). */
export function jobFromRow(row: AssignmentRow): Job | null {
  if (row.assignment.status !== "in_progress" || row.job.jobKind === "competition") return null;
  const buyerSaid = row.latestMessage?.senderSide === "buyer" ? row.latestMessage.body : null;
  return {
    assignmentId: row.assignment.assignmentId,
    texts: [buyerSaid, `${row.job.title}\n${row.job.description}`],
    delivered: Boolean(row.assignment.deliverableUrl),
  };
}

/**
 * Serves every in_progress assignment. An in_progress row is work not yet delivered: a fresh
 * hire, a request for changes, or a dispute redo; a delivered one leaves the list as `submitted`.
 */
export async function pollOnce(deps: Deps, max = 10): Promise<Outcome[]> {
  const jobs = (await listInProgress(deps)).map(jobFromRow).filter((j): j is Job => j !== null).slice(0, max);
  const outcomes: Outcome[] = [];
  for (const job of jobs) outcomes.push(await deliver(deps, job));
  return outcomes;
}

// --- the push side: webhook bodies (webhooks.md, "Events") ---

export type WebhookEvent = {
  event?: string;
  assignment_id?: string;
  title?: string;
  description?: string;
  ruling?: string;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * What a verified webhook asks of us:
 * - `hire.created` carries the brief, so it is served straight from the body;
 * - `hire.changes_requested` and a `redo` ruling put the assignment back in progress with
 *   feedback on the thread, so the assignment is re-read from the list and served again;
 * - everything else (webhook.ping, hire.accepted, hire.refunded, message.created, ...) needs nothing.
 */
export function planFor(body: WebhookEvent): { kind: "hire"; job: Job } | { kind: "reread"; assignmentId: string } | { kind: "none" } {
  const id = typeof body.assignment_id === "string" && UUID.test(body.assignment_id) ? body.assignment_id : null;
  if (!id) return { kind: "none" };
  if (body.event === "hire.created") {
    const brief = `${typeof body.title === "string" ? body.title : ""}\n${typeof body.description === "string" ? body.description : ""}`;
    return { kind: "hire", job: { assignmentId: id, texts: [brief] } };
  }
  if (body.event === "hire.changes_requested" || (body.event === "hire.dispute_resolved" && body.ruling === "redo")) {
    return { kind: "reread", assignmentId: id };
  }
  return { kind: "none" };
}

export async function handleEvent(deps: Deps, body: WebhookEvent): Promise<Outcome | null> {
  const plan = planFor(body);
  if (plan.kind === "hire") return deliver(deps, plan.job);
  if (plan.kind === "reread") {
    const row = (await listInProgress(deps)).find((r) => r.assignment.assignmentId === plan.assignmentId);
    const job = row ? jobFromRow(row) : null;
    return job ? deliver(deps, job) : null;
  }
  return null;
}
