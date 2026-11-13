// Sends one signed transaction through every RPC node at once and follows it to the end.
// Used by the browser (free test accounts) and the server (the guest sponsor), because a
// public node that stalls must never leave anyone waiting: every request has a timeout,
// nobody waits on a slow node, and the first final answer wins. Sending the same signed
// transaction more than once is safe: the network executes a transaction hash only once.

import type { RawOutcome } from "./outcome";

type RpcReply = { result?: Record<string, unknown>; error?: { name?: string; cause?: { name?: string }; data?: unknown; message?: string } };

async function rpcCall(url: string, method: string, params: object, ms: number): Promise<RpcReply> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "lien", method, params }),
    signal: AbortSignal.timeout(ms),
  });
  return (await response.json()) as RpcReply;
}

export type Signed = {
  /** The signed transaction, base64. */
  encoded: string;
  /** Its hash, base58. */
  hash: string;
  /** The signer, needed to look the transaction up. */
  sender: string;
};

/** Hashes and encodes a near-api-js SignedTransaction for `sendSigned`. */
export async function prepareSigned(signed: { encode(): Uint8Array; transaction: { encode(): Uint8Array } }, sender: string): Promise<Signed> {
  const { base64Encode, baseEncode } = await import("near-api-js");
  const digest = await crypto.subtle.digest("SHA-256", signed.transaction.encode() as BufferSource);
  return { encoded: base64Encode(signed.encode()), hash: baseEncode(new Uint8Array(digest)), sender };
}

/** Broadcasts to every node; resolves when one accepts, rejects only on a real refusal. */
function broadcast(urls: string[], encoded: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let open = urls.length;
    let done = false;
    const finish = (error?: Error) => {
      if (done) return;
      done = true;
      if (error) reject(error);
      else resolve();
    };
    for (const url of urls) {
      rpcCall(url, "send_tx", { signed_tx_base64: encoded, wait_until: "NONE" }, 10_000)
        .then((reply) => {
          if (reply.result) finish();
          // Only the network rejecting the transaction itself is final. A rate limit, a retired
          // endpoint or a node error from one provider is trouble with that node, not an answer.
          else if (reply.error?.cause?.name === "INVALID_TRANSACTION") finish(new Error(JSON.stringify(reply.error.data ?? reply.error.cause)));
        })
        .catch(() => { /* a stalled or unreachable node */ })
        .finally(() => { if (--open === 0) finish(); });
    }
  });
}

/**
 * Sends and waits for the final outcome, asking every node each round. `withinMs` bounds the
 * wait: a few minutes in the browser, where a job waits for the enclave; less on a server.
 */
export async function sendSigned(urls: string[], tx: Signed, withinMs: number): Promise<RawOutcome> {
  await broadcast(urls, tx.encoded);
  const deadline = Date.now() + withinMs;
  for (let round = 0; Date.now() < deadline; round++) {
    let unknown = 0;
    const final = await Promise.any(
      urls.map(async (url) => {
        const reply = await rpcCall(url, "tx", { tx_hash: tx.hash, sender_account_id: tx.sender, wait_until: "FINAL" }, Math.min(12_000, Math.max(1_000, deadline - Date.now())));
        if (reply.result?.status) return reply.result as unknown as RawOutcome;
        if (reply.error?.cause?.name === "UNKNOWN_TRANSACTION") unknown++;
        throw new Error("not final yet");
      }),
    ).catch(() => null);
    if (final) return final;
    if (unknown === urls.length && round % 3 === 2) await broadcast(urls, tx.encoded).catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error("The network has not confirmed this yet. It may still go through: refresh in a minute before trying again.");
}

/** Runs `step` against each node in turn with a timeout, for reads that come before sending. */
export async function acrossNodes<T>(urls: string[], step: (url: string) => Promise<T>, ms = 8_000): Promise<T> {
  let last: unknown;
  for (const url of urls) {
    try {
      return await Promise.race([step(url), new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), ms))]);
    } catch (error) {
      last = error;
    }
  }
  throw last instanceof Error ? last : new Error("The network could not be reached.");
}
