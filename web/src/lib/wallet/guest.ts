// A throwaway testnet account held in this browser, so someone can try the whole
// product without installing a wallet. The key only ever controls free test funds.

import { RPC_URLS, NETWORK } from "../config";
import type { TxRequest } from "../near/actions";
import type { RawOutcome } from "../near/outcome";

const STORAGE_KEY = "lien.guest";

export type Guest = { accountId: string; privateKey: string };

export function loadGuest(): Guest | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Guest) : null;
  } catch {
    return null;
  }
}

export function forgetGuest() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage may be blocked. The session still ends.
  }
}

export async function createGuest(): Promise<Guest> {
  const { KeyPair } = await import("near-api-js");
  const pair = KeyPair.fromRandom("ed25519");
  const response = await fetch("/api/guest", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ publicKey: pair.getPublicKey().toString() }),
  });
  const { accountId, error } = (await response.json().catch(() => ({}))) as { accountId?: string; error?: string };
  if (!response.ok || !accountId) {
    throw new Error(error || "A test account could not be created. Try again in a minute.");
  }
  const guest = { accountId, privateKey: pair.toString() };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(guest));
  } catch {
    // Without storage the guest lasts until the page is closed.
  }
  // The faucet answers before the account is visible on every RPC node.
  await waitForAccount(accountId);
  return guest;
}

/**
 * Asks the sponsor for NEAR: enough to start a business, or a little for network fees
 * once a guest has spent what it started with. Returns the NEAR added ("0" if none was needed).
 */
export async function topUpGuest(accountId: string, reason: "business" | "fees" = "business"): Promise<string> {
  const response = await fetch("/api/guest", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ topUp: accountId, reason }),
  });
  const body = (await response.json().catch(() => ({}))) as { error?: string; near?: string };
  if (!response.ok) throw new Error(body.error || "Your test account could not be topped up.");
  return body.near ?? "0";
}

async function waitForAccount(accountId: string) {
  const { accountExists } = await import("../near/rpc");
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (await accountExists(accountId).catch(() => false)) return;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error("The new account did not appear on the network in time.");
}

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

const transient = (error: RpcReply["error"]) =>
  !error || ["TIMEOUT_ERROR", "UNKNOWN_TRANSACTION", "INTERNAL_ERROR"].includes(error.cause?.name ?? "") || error.name === "INTERNAL_ERROR";

/**
 * Signs once, then broadcasts that one signed transaction to each RPC node in turn and
 * follows it to the end. A public node that stalls never leaves the page waiting: every
 * request has a timeout and the next node takes over. Sending the same signed transaction
 * twice is safe, since the network executes a transaction hash only once.
 */
export async function sendAsGuest(guest: Guest, request: TxRequest): Promise<RawOutcome> {
  const { Account, JsonRpcProvider, actions, base64Encode, baseEncode } = await import("near-api-js");
  const urls = RPC_URLS[NETWORK];
  const signer = new Account(guest.accountId, new JsonRpcProvider({ url: urls[0]! }), guest.privateKey as `ed25519:${string}`);
  const signed = await signer.createSignedTransaction({
    receiverId: request.receiverId,
    actions: request.calls.map((call) =>
      actions.functionCall(call.methodName, call.args, BigInt(call.gasTera) * 10n ** 12n, BigInt(call.deposit)),
    ),
  });
  const encoded = base64Encode(signed.encode());
  const hash = baseEncode(new Uint8Array(await crypto.subtle.digest("SHA-256", signed.transaction.encode() as BufferSource)));

  const broadcast = async () => {
    for (const url of urls) {
      try {
        const reply = await rpcCall(url, "send_tx", { signed_tx_base64: encoded, wait_until: "INCLUDED" }, 15_000);
        if (reply.result || transient(reply.error)) return;
        throw new Error(JSON.stringify(reply.error?.data ?? reply.error?.message ?? reply.error));
      } catch (error) {
        if (!(error instanceof DOMException) && !(error instanceof TypeError) && !(error instanceof SyntaxError)) throw error; // a real refusal, not a stalled node
      }
    }
  };
  await broadcast();

  // Jobs settle only when the enclave answers, so allow minutes, asking a different node each time.
  const deadline = Date.now() + 8 * 60_000;
  for (let attempt = 0; Date.now() < deadline; attempt++) {
    const url = urls[attempt % urls.length]!;
    try {
      const reply = await rpcCall(url, "tx", { tx_hash: hash, sender_account_id: guest.accountId, wait_until: "FINAL" }, 20_000);
      if (reply.result?.status) return reply.result as unknown as RawOutcome;
      if (reply.error?.cause?.name === "UNKNOWN_TRANSACTION" && attempt % 3 === 2) await broadcast();
    } catch {
      /* a stalled or unreachable node: the next one is asked */
    }
    await new Promise((resolve) => setTimeout(resolve, 1_500));
  }
  throw new Error("The network has not confirmed this yet. It may still go through: refresh in a minute before trying again.");
}
