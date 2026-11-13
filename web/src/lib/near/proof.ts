// The checks behind "don't trust us". Each runs in the visitor's browser against
// public infrastructure, so no Lien server is involved in the answer.

import { deployment, isTestnet, OUTLAYER_API } from "../config";
import { accessKeyCount, tokenBalance, viewAccount } from "./rpc";
import type { Business, Ledger } from "./types";

export type Check = { ok: boolean; detail: string };

/**
 * Fetches public infrastructure patiently: a timeout per try and up to three tries, so one
 * slow answer never turns a proven fact into "could not check". Only network trouble is
 * retried (no answer, 429, 5xx); a real answer such as 404 is returned at once.
 */
export async function patientFetch(url: string, init: RequestInit = {}, tries = 3, timeoutMs = 15_000): Promise<Response> {
  let last: unknown;
  for (let attempt = 0; attempt < tries; attempt++) {
    try {
      const response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
      if (response.status !== 429 && response.status < 500) return response;
      last = new Error(`${url} answered ${response.status}`);
    } catch (error) {
      last = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 800 * (attempt + 1)));
  }
  throw last instanceof Error ? last : new Error(`${url} could not be reached`);
}

export const ledgerTotal = (l: Ledger) =>
  [l.opex, l.operator, l.lender_pool, l.funding_escrow, l.job_escrow, l.auction_escrow, l.credits].reduce((sum, v) => sum + BigInt(v), 0n);

export async function checkNoKeys(id: string): Promise<Check> {
  const count = await accessKeyCount(id);
  return { ok: count === 0, detail: count === 0 ? "Zero access keys on the account" : `${count} access key(s) found` };
}

export async function checkCode(id: string): Promise<Check> {
  const account = await viewAccount(id);
  const hash = account.global_contract_hash ?? account.code_hash;
  const ok = hash === deployment.agentCode;
  return { ok, detail: ok ? "Runs the published Lien contract" : `Runs different code: ${hash}` };
}

export async function checkBuild(url: string, expected: string): Promise<Check> {
  const response = await patientFetch(url, {}, 3, 30_000);
  if (!response.ok) return { ok: false, detail: `The build could not be fetched (${response.status})` };
  const digest = await crypto.subtle.digest("SHA-256", await response.arrayBuffer());
  const actual = Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
  return {
    ok: actual === expected,
    detail: actual === expected ? "Published bytes hash to the pinned value" : `Published bytes hash to ${actual}`,
  };
}

export async function checkSolvent(b: Business): Promise<Check & { held: bigint; owed: bigint }> {
  const held = await tokenBalance(b.id);
  const owed = ledgerTotal(b.ledger);
  return { ok: held >= owed, held, owed, detail: held >= owed ? "Tokens held cover every obligation" : "Tokens held are below the ledger" };
}

export type Attestation = {
  request_id: number;
  transaction_hash: string;
  executed_wasm_sha256: string;
  worker_measurement: string;
  input_hash: string;
  output_hash: string;
  tdx_quote: string;
  timestamp: number;
};

const TX_API = isTestnet ? "https://tx.test.fastnear.com" : "https://tx.main.fastnear.com";

export async function attestationForTx(tx: string): Promise<Attestation | null> {
  const response = await patientFetch(`${OUTLAYER_API}/attestations/by-tx/${tx}`);
  if (!response.ok) return null;
  const body = (await response.json().catch(() => null)) as Attestation | null;
  return body?.tdx_quote ? body : null;
}

/** Finds the newest TEE attestation among the business's recent transactions. */
export async function latestAttestation(id: string): Promise<Attestation | null> {
  const response = await patientFetch(`${TX_API}/v0/account`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ account_id: id }),
  });
  if (!response.ok) return null;
  const { account_txs: txs = [] } = (await response.json()) as { account_txs?: Array<{ transaction_hash: string; tx_block_height: number }> };
  const newest = [...txs].sort((a, b) => b.tx_block_height - a.tx_block_height).slice(0, 12);
  for (const tx of newest) {
    const attestation = await attestationForTx(tx.transaction_hash).catch(() => null);
    if (attestation) return attestation;
  }
  return null;
}
