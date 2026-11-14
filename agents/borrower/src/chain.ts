// Keys, sending and reading the chain for the borrower agent. Its key lives in the
// standard NEAR credentials folder (~/.near-credentials/testnet/<agent>.json), never here.

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { Account, FailoverRpcProvider, JsonRpcProvider, actions, type KeyPairString } from "near-api-js";
import { parseCounterMemo, type CounterMemo } from "../../lender/src/counter";
import type { Prepared } from "../../lender/src/guard";

export const RPCS = (process.env.BORROWER_RPC ?? "https://rpc.testnet.fastnear.com,https://testnet-rpc.intea.rs,https://near-testnet.drpc.org,https://api.zan.top/near-testnet").split(",");
const CREDS = join(homedir(), ".near-credentials", "testnet");
export const provider = () => new FailoverRpcProvider(RPCS.map((url) => new JsonRpcProvider({ url })));
export const explorer = (hash: string) => `https://testnet.nearblocks.io/txns/${hash}`;

export function keyAccount(id: string): Account {
  const path = join(CREDS, `${id}.json`);
  if (!existsSync(path)) throw new Error(`No key for ${id} at ${path}. Run: npm run setup`);
  const { private_key } = JSON.parse(readFileSync(path, "utf8")) as { private_key: KeyPairString };
  return new Account(id, provider(), private_key);
}

export const view = async <T = any>(contractId: string, method: string, args: Record<string, unknown> = {}) =>
  (await provider().callFunction({ contractId, method, args })) as T;

export type Sent = { tx: string; ok: boolean; failure?: string; logs: string[]; failedOn: string[]; value?: unknown };

/** Sends function calls signed by `signer` and waits for the final outcome. */
export async function sendCalls(signer: Account, receiverId: string, calls: Array<{ method: string; args: Record<string, unknown>; gas: bigint; deposit: bigint }>): Promise<Sent> {
  const outcome = await signer.signAndSendTransaction({
    receiverId,
    actions: calls.map((c) => actions.functionCall(c.method, c.args, c.gas, c.deposit)),
    waitUntil: "FINAL",
    throwOnFailure: false,
  });
  const status = outcome.status as { Failure?: unknown; SuccessValue?: string };
  const receipts = outcome.receipts_outcome ?? [];
  const raw = status.SuccessValue ? Buffer.from(status.SuccessValue, "base64").toString() : "";
  return {
    tx: outcome.transaction.hash,
    ok: !status.Failure,
    failure: status.Failure ? JSON.stringify(status.Failure) : undefined,
    logs: receipts.flatMap((r) => r.outcome.logs),
    failedOn: receipts.filter((r) => (r.outcome.status as { Failure?: unknown }).Failure).map((r) => r.outcome.executor_id),
    value: raw ? JSON.parse(raw) : undefined,
  };
}

/** Signs a transaction the MCP server prepared, exactly as given. */
export const sendPrepared = (signer: Account, tx: Prepared) =>
  sendCalls(signer, tx.receiver_id, tx.actions.map((a) => ({ method: a.method_name, args: a.args, gas: BigInt(a.gas), deposit: BigInt(a.deposit) })));

async function rpc(method: string, params: unknown): Promise<any> {
  let last: unknown;
  for (const url of RPCS) {
    try {
      const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: AbortSignal.timeout(30_000) });
      const body = (await response.json()) as { result?: unknown; error?: unknown };
      if (body.error) throw new Error(JSON.stringify(body.error));
      return body.result;
    } catch (error) {
      last = error;
    }
  }
  throw last;
}

export type VerifiedCounter = { tx: string; from: string; memo: CounterMemo };

/**
 * Reads one transaction from RPC and returns it as a counter only if the chain says so:
 * it succeeded, it is `ft_transfer` on the pinned token, it pays this account, and its
 * memo parses. The lender is whoever signed it; nothing it claims elsewhere is used.
 */
export async function verifyCounterTx(hash: string, sender: string, me: string, token: string): Promise<VerifiedCounter | null> {
  const r = await rpc("tx", { tx_hash: hash, sender_account_id: sender, wait_until: "FINAL" });
  const t = r?.transaction;
  if (!t || t.signer_id !== sender || t.receiver_id !== token) return null;
  if (!r.status || "Failure" in r.status) return null;
  const call = t.actions?.[0]?.FunctionCall;
  if (!call || call.method_name !== "ft_transfer" || t.actions.length !== 1) return null;
  let args: any;
  try {
    args = JSON.parse(Buffer.from(call.args, "base64").toString());
  } catch {
    return null;
  }
  if (args.receiver_id !== me) return null;
  const memo = parseCounterMemo(args.memo);
  return memo ? { tx: hash, from: sender, memo } : null;
}

/**
 * Finds counters sent to this account. An indexer (NearBlocks) is used only to list
 * candidate transaction hashes; each is then verified from RPC. Hashes given in
 * COUNTER_TX ("hash:sender,...") are checked the same way, for when the indexer lags.
 */
export async function findCounters(me: string, token: string): Promise<VerifiedCounter[]> {
  const candidates = new Map<string, string>();
  for (const pair of (process.env.COUNTER_TX ?? "").split(",").filter(Boolean)) {
    const [hash, sender] = pair.split(":");
    if (hash && sender) candidates.set(hash, sender);
  }
  try {
    const response = await fetch(`https://api-testnet.nearblocks.io/v1/account/${me}/ft-txns?per_page=50`, { signal: AbortSignal.timeout(20_000) });
    const body = (await response.json()) as { txns?: Array<{ transaction_hash: string; involved_account_id: string | null; delta_amount: string; ft?: { contract: string } }> };
    for (const t of body.txns ?? []) {
      if (t.ft?.contract === token && t.delta_amount === "1" && t.involved_account_id) candidates.set(t.transaction_hash, t.involved_account_id);
    }
  } catch {
    /* the indexer is a convenience; COUNTER_TX still works */
  }
  const found: VerifiedCounter[] = [];
  for (const [hash, sender] of candidates) {
    const v = await verifyCounterTx(hash, sender, me, token).catch(() => null);
    if (v) found.push(v);
  }
  return found;
}

/** One JSON object per line, appended. */
export function logger(path: string, run: string) {
  mkdirSync(dirname(path), { recursive: true });
  const log = (entry: Record<string, unknown>) => {
    const line = JSON.stringify({ at: new Date().toISOString(), run, ...entry }, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
    appendFileSync(path, `${line}\n`);
    console.log(line);
  };
  return Object.assign(log, { path });
}

export function readLog(path: string): Array<Record<string, any>> {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8").split("\n").flatMap((line) => {
    try {
      return line ? [JSON.parse(line) as Record<string, any>] : [];
    } catch {
      return [];
    }
  });
}
