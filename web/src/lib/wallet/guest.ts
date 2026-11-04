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

/** Asks the sponsor for enough NEAR to start a business. */
export async function topUpGuest(accountId: string) {
  const response = await fetch("/api/guest", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ topUp: accountId }),
  });
  if (!response.ok) {
    const { error } = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(error || "Your test account could not be topped up.");
  }
}

async function waitForAccount(accountId: string) {
  const { accountExists } = await import("../near/rpc");
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (await accountExists(accountId).catch(() => false)) return;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error("The new account did not appear on the network in time.");
}

export async function sendAsGuest(guest: Guest, request: TxRequest): Promise<RawOutcome> {
  const { Account, JsonRpcProvider, actions } = await import("near-api-js");
  const provider = new JsonRpcProvider({ url: RPC_URLS[NETWORK][0]! });
  const signer = new Account(guest.accountId, provider, guest.privateKey as `ed25519:${string}`);
  const outcome = await signer.signAndSendTransaction({
    receiverId: request.receiverId,
    actions: request.calls.map((call) =>
      actions.functionCall(call.methodName, call.args, BigInt(call.gasTera) * 10n ** 12n, BigInt(call.deposit)),
    ),
    waitUntil: "FINAL",
    throwOnFailure: false,
  });
  return outcome as unknown as RawOutcome;
}
