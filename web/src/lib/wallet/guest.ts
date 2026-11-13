// A throwaway testnet account held in this browser, so someone can try the whole
// product without installing a wallet. The key only ever controls free test funds.

import { RPC_URLS, NETWORK } from "../config";
import type { TxRequest } from "../near/actions";
import type { RawOutcome } from "../near/outcome";
import { acrossNodes, prepareSigned, sendSigned } from "../near/send";

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
    signal: AbortSignal.timeout(60_000),
  }).catch(() => {
    throw new Error("Creating your test account is taking too long. The test network may be busy: try again in a minute, or connect a wallet.");
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
    signal: AbortSignal.timeout(60_000),
  }).catch(() => {
    throw new Error("Adding NEAR to your test account is taking too long. Try again in a minute.");
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

/** Signs once, then sends through every RPC node at once and follows it to the end (lib/near/send.ts). */
export async function sendAsGuest(guest: Guest, request: TxRequest): Promise<RawOutcome> {
  const { Account, JsonRpcProvider, actions } = await import("near-api-js");
  const urls = RPC_URLS[NETWORK];
  // Signing reads the key's nonce and a recent block: from whichever node answers first in turn.
  const signed = await acrossNodes(urls, (url) =>
    new Account(guest.accountId, new JsonRpcProvider({ url }), guest.privateKey as `ed25519:${string}`).createSignedTransaction({
      receiverId: request.receiverId,
      actions: request.calls.map((call) =>
        actions.functionCall(call.methodName, call.args, BigInt(call.gasTera) * 10n ** 12n, BigInt(call.deposit)),
      ),
    }),
  );
  // Jobs settle only when the enclave answers, so the browser allows minutes.
  return sendSigned(urls, await prepareSigned(signed, guest.accountId), 8 * 60_000);
}
