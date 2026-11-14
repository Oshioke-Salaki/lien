// Reads what the books need, every call at the same final block, so the balance and the
// ledger it is checked against are one moment of the chain. Shared by the page and
// /api/books/[id], and cached a few seconds per business on the server.

import { computeBooks, type Books } from "./books";
import { deployment } from "./config";
import { viewAt, type BlockRef } from "./near/rpc";
import type { AgentView, Job, LoanView } from "./near/types";

const PAGE = 50;

/** Pages newest-first lists (get_jobs, get_loans) down to id 0, or `maxPages` pages. */
async function pages<T extends { id: number }>(id: string, method: string, top: number, at: BlockRef, maxPages: number): Promise<T[]> {
  const out: T[] = [];
  let from = top;
  for (let i = 0; i < maxPages && from > 0; i++) {
    const { value } = await viewAt<T[]>(id, method, { from, limit: PAGE }, at);
    out.push(...value);
    from -= PAGE;
  }
  return out;
}

export const isBusinessId = (id: string) => id.endsWith(`.${deployment.registry}`) && id.length <= 64;

/** One try; a node that does not have the block yet answers an error, so the read is tried once more. */
export async function readBooks(id: string): Promise<Books> {
  try {
    return await readOnce(id);
  } catch (error) {
    if (/UNKNOWN_ACCOUNT|CodeDoesNotExist|MethodNotFound|MethodResolveError|does not exist/i.test(String(error instanceof Error ? error.message : error))) throw error;
    return readOnce(id);
  }
}

async function readOnce(id: string): Promise<Books> {
  const first = await viewAt<AgentView>(id, "get_agent");
  const at: BlockRef = { block_id: first.block.height };
  const business = { ...first.value, id };
  const [held, loans, jobs] = await Promise.all([
    viewAt<string>(deployment.token, "ft_balance_of", { account_id: id }, at).then((r) => r.value),
    pages<LoanView>(id, "get_loans", business.loan_count, at, 20),
    // The contract keeps 200 jobs; five pages reach past them.
    pages<Job>(id, "get_jobs", business.next_job_id, at, 5),
  ]);
  return computeBooks({ business, jobs, loans, held, block: first.block });
}

type Entry = { at: number; value?: Books; pending?: Promise<Books> };
const store = new Map<string, Entry>();

/** One read per business shared by every request for five seconds. */
export function cachedBooks(id: string): Promise<Books> {
  const entry = store.get(id);
  if (entry?.value && Date.now() - entry.at < 5_000) return Promise.resolve(entry.value);
  if (entry?.pending) return entry.pending;
  const pending = readBooks(id)
    .then((value) => {
      store.set(id, { at: Date.now(), value });
      if (store.size > 300) store.delete(store.keys().next().value!);
      return value;
    })
    .finally(() => {
      const now = store.get(id);
      if (now?.pending === pending) store.set(id, { at: now.at, value: now.value });
    });
  store.set(id, { at: entry?.at ?? 0, value: entry?.value, pending });
  return pending;
}
