// Keys and sending. The agent's keys live in the standard NEAR credentials folder,
// never in this repository:
//   ~/.near-credentials/testnet/<agent>.json                     the full-access key (spends)
//   ~/.near-credentials/testnet/lien-lender/<agent>/<receiver>.json  function-call keys
//
// NEAR's protocol lets a function-call key attach no deposit at all (the allowance
// pays gas only). ft_transfer_call requires exactly 1 yoctoNEAR, so lending and hiring
// need the full-access key. Collecting (claim) and foreclosing (foreclose) attach
// nothing, so the agent adds a key scoped to just those two methods on each business
// it lends to, and signs them with it.

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { Account, FailoverRpcProvider, JsonRpcProvider, KeyPair, actions, type KeyPairString } from "near-api-js";
import type { Prepared } from "./guard";

/** Independent testnet providers, tried in turn when one throttles. Resending the same
 *  signed transaction is harmless: it has one hash and can land only once. */
export const RPCS = (process.env.LENDER_RPC ?? "https://rpc.testnet.fastnear.com,https://testnet-rpc.intea.rs,https://near-testnet.drpc.org,https://api.zan.top/near-testnet").split(",");
const CREDS = join(homedir(), ".near-credentials", "testnet");

export const provider = () => new FailoverRpcProvider(RPCS.map((url) => new JsonRpcProvider({ url })));

export function fullKeyAccount(me: string): Account {
  const path = join(CREDS, `${me}.json`);
  if (!existsSync(path)) throw new Error(`No key for ${me} at ${path}. Run: npm run setup`);
  const { private_key } = JSON.parse(readFileSync(path, "utf8")) as { private_key: KeyPairString };
  return new Account(me, provider(), private_key);
}

const fcPath = (me: string, receiver: string) => join(CREDS, "lien-lender", me, `${receiver}.json`);

export type FcKey = { account_id: string; public_key: string; private_key: KeyPairString; receiver: string; methods: string[] };

export function fcKey(me: string, receiver: string): FcKey | null {
  const path = fcPath(me, receiver);
  return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as FcKey) : null;
}

export const fcAccount = (key: FcKey) => new Account(key.account_id, provider(), key.private_key);

/** Adds a key that can call only `methods` on `receiver`, and pays gas only from `allowance`. */
export async function addFcKey(full: Account, receiver: string, methods: string[], allowanceYocto: bigint) {
  const pair = KeyPair.fromRandom("ed25519");
  const key: FcKey = { account_id: full.accountId, public_key: pair.getPublicKey().toString(), private_key: pair.toString() as KeyPairString, receiver, methods };
  const path = fcPath(full.accountId, receiver);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(key, null, 2), { mode: 0o600 });
  const outcome = await full.addFunctionCallAccessKey({ publicKey: key.public_key, contractId: receiver, methodNames: methods, allowance: allowanceYocto });
  return { key, tx: outcome.transaction.hash };
}

export type Sent = { tx: string; ok: boolean; failure?: string; logs: string[]; failedOn: string[] };

/** Signs a prepared transaction exactly as given and waits for the final outcome. */
export async function send(signer: Account, tx: Prepared): Promise<Sent> {
  const outcome = await signer.signAndSendTransaction({
    receiverId: tx.receiver_id,
    actions: tx.actions.map((a) => actions.functionCall(a.method_name, a.args, BigInt(a.gas), BigInt(a.deposit))),
    waitUntil: "FINAL",
    throwOnFailure: false,
  });
  const status = outcome.status as { Failure?: unknown };
  const receipts = outcome.receipts_outcome ?? [];
  return {
    tx: outcome.transaction.hash,
    ok: !status.Failure,
    failure: status.Failure ? JSON.stringify(status.Failure) : undefined,
    logs: receipts.flatMap((r) => r.outcome.logs),
    failedOn: receipts.filter((r) => (r.outcome.status as { Failure?: unknown }).Failure).map((r) => r.outcome.executor_id),
  };
}

/** The job id a purchase started, read from the contract's own event log. */
export function jobIdFromLogs(logs: string[]): number | null {
  for (const line of logs) {
    if (!line.startsWith("EVENT_JSON:")) continue;
    try {
      const event = JSON.parse(line.slice("EVENT_JSON:".length)) as { event?: string; data?: Array<{ job_id?: number }> | { job_id?: number } };
      const data = Array.isArray(event.data) ? event.data[0] : event.data;
      if (event.event === "job_started" && typeof data?.job_id === "number") return data.job_id;
    } catch {
      /* not an event line */
    }
  }
  return null;
}

/** One JSON object per line, appended. */
export function logger(path: string, run: string) {
  mkdirSync(dirname(path), { recursive: true });
  return (entry: Record<string, unknown>) => {
    const line = JSON.stringify({ at: new Date().toISOString(), run, ...entry }, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
    appendFileSync(path, `${line}\n`);
    console.log(line);
  };
}

export const explorer = (hash: string) => `https://testnet.nearblocks.io/txns/${hash}`;
