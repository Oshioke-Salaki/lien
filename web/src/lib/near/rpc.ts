// Read-only chain access. No library: a view call is one JSON POST.

import { RPC_URLS, NETWORK, deployment } from "../config";
import type { AgentView, Business, Job, LoanView, NoteView } from "./types";

const RPC_TIMEOUT_MS = 8_000;

export class RpcError extends Error {}

/** Node trouble rather than an answer about the chain: the next node is asked. */
const NODE_TROUBLE = new Set(["TIMEOUT_ERROR", "INTERNAL_ERROR", "NO_SYNCED_BLOCKS", "NOT_SYNCED_YET"]);

async function rpc<T>(params: unknown): Promise<T> {
  let last: unknown;
  // Start at a random node so reads spread across providers instead of exhausting one's free tier.
  const urls = RPC_URLS[NETWORK];
  const start = Math.floor(Math.random() * urls.length);
  for (const url of [...urls.slice(start), ...urls.slice(0, start)]) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: "lien", method: "query", params }),
        // A hung node must not hold up the next one.
        signal: AbortSignal.timeout(RPC_TIMEOUT_MS),
      });
      if (!response.ok) throw new RpcError(`RPC answered ${response.status}`);
      const body = (await response.json()) as { result?: T & { error?: string }; error?: { cause?: { name?: string }; message?: string } };
      if (body.error) {
        const cause = body.error.cause?.name;
        // A rate limit (-429), a retired endpoint or a node error says nothing about the chain.
        if (!cause || NODE_TROUBLE.has(cause)) throw new RpcError(`RPC answered with node trouble: ${body.error.message ?? cause ?? "unknown"}`);
        throw new RpcError(cause);
      }
      if (body.result?.error) throw new RpcError(body.result.error);
      return body.result as T;
    } catch (error) {
      last = error;
      // An answer from the chain is final; only a network failure tries the next.
      if (error instanceof RpcError && !/answered/.test(error.message)) throw error;
    }
  }
  throw last instanceof Error ? last : new RpcError("No RPC endpoint could be reached");
}

const toBase64 = (text: string) =>
  btoa(String.fromCharCode(...new TextEncoder().encode(text)));

export async function view<T>(contract: string, method: string, args: object = {}): Promise<T> {
  const result = await rpc<{ result: number[] }>({
    request_type: "call_function",
    finality: "optimistic",
    account_id: contract,
    method_name: method,
    args_base64: toBase64(JSON.stringify(args)),
  });
  return JSON.parse(new TextDecoder().decode(new Uint8Array(result.result))) as T;
}

export type AccountState = { amount: string; code_hash: string; global_contract_hash?: string | null; storage_usage: number };

export const viewAccount = (accountId: string) =>
  rpc<AccountState>({ request_type: "view_account", finality: "optimistic", account_id: accountId });

export async function accessKeyCount(accountId: string): Promise<number> {
  const result = await rpc<{ keys: unknown[] }>({
    request_type: "view_access_key_list",
    finality: "optimistic",
    account_id: accountId,
  });
  return result.keys.length;
}

export async function accountExists(accountId: string): Promise<boolean> {
  try {
    await viewAccount(accountId);
    return true;
  } catch (error) {
    if (error instanceof RpcError && /UNKNOWN_ACCOUNT|does not exist/i.test(error.message)) return false;
    throw error;
  }
}

export const tokenBalance = async (accountId: string) =>
  BigInt(await view<string>(deployment.token, "ft_balance_of", { account_id: accountId }));

export const isRegistered = async (accountId: string) =>
  (await view<unknown>(deployment.token, "storage_balance_of", { account_id: accountId })) !== null;

export const listBusinessIds = () => view<string[]>(deployment.registry, "get_agents", { limit: 100 });

export const getBusiness = async (id: string): Promise<Business> => ({
  ...(await view<AgentView>(id, "get_agent")),
  id,
});

/** Automated test runs (script and browser) live in the registry too, but are not a market listing. */
export const isTestRun = (id: string) => id.startsWith("e2e-") || id.startsWith("ui-");

/** Market listing. Pass `includeTests` where a holder must still see every position they own. */
export async function listBusinesses({ includeTests = false } = {}): Promise<Business[]> {
  const ids = (await listBusinessIds()).filter((id) => includeTests || !isTestRun(id));
  const settled = await Promise.allSettled(ids.map(getBusiness));
  return settled.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
}

export const getJobs = (id: string, limit = 20) => view<Job[]>(id, "get_jobs", { limit });
export const getJob = (id: string, jobId: number) => view<Job | null>(id, "get_job", { job_id: jobId });
export const getLoans = (id: string, limit = 50) => view<LoanView[]>(id, "get_loans", { limit });
export const getNote = (id: string, loanId: number, account: string) =>
  view<NoteView | null>(id, "get_note", { loan_id: loanId, account_id: account });
export const getCredit = async (id: string, account: string) =>
  BigInt(await view<string>(id, "get_credit", { account_id: account }));
