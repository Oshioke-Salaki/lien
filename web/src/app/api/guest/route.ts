import { NextResponse } from "next/server";
import { Account, JsonRpcProvider, actions, nearToYocto, PublicKey, type KeyPairString } from "near-api-js";
import { RPC_URLS } from "@/lib/config";
import { acrossNodes, prepareSigned, sendSigned } from "@/lib/near/send";

// A stalled public node must not hang the request: sends go through every node at once.
export const maxDuration = 60;
const SEND_WITHIN_MS = 40_000;

/** Signs as the sponsor and sends through every node; throws if the transaction failed. */
async function sponsorSend(sponsorKey: string, sponsorId: string, receiverId: string, list: ReturnType<typeof actions.transfer>[]) {
  const signed = await acrossNodes(RPC_URLS.testnet, (url) =>
    new Account(sponsorId, new JsonRpcProvider({ url }), sponsorKey as KeyPairString).createSignedTransaction({ receiverId, actions: list }),
  );
  const outcome = await sendSigned(RPC_URLS.testnet, await prepareSigned(signed, sponsorId), SEND_WITHIN_MS);
  const status = (outcome as unknown as { status?: { Failure?: unknown } }).status;
  if (status?.Failure) throw new Error(JSON.stringify(status.Failure));
}

// Creates a free testnet account for someone trying the product without a wallet.
//
// The public faucet allows one account per IP address about every 11 hours, which
// would fail for nearly everyone on a shared server. So a small sponsor account
// creates them instead, and the public faucet is only the fallback for people
// running the app themselves without a sponsor configured.

const FAUCET = "https://helper.nearprotocol.com/account";
const KEY = /^ed25519:[1-9A-HJ-NP-Za-km-z]{32,64}$/;
/** Enough for any transaction, since NEAR holds back about 0.3 for gas up front. */
const GUEST_NEAR = "0.45";
/** Added when a guest starts a business, which costs 0.5 NEAR on top of gas. */
const BUSINESS_NEAR = "0.6";
const BUSINESS_MINIMUM = 800_000_000_000_000_000_000_000n;
/** A guest below this has spent its NEAR on fees; it gets FEES_NEAR more. */
const FEES_MINIMUM = 300_000_000_000_000_000_000_000n;
const FEES_NEAR = "0.3";
const LIMIT_PER_HOUR = 6;

const recent = new Map<string, number[]>();

function allowed(ip: string): boolean {
  const cutoff = Date.now() - 3_600_000;
  const times = (recent.get(ip) ?? []).filter((t) => t > cutoff);
  if (times.length >= LIMIT_PER_HOUR) return false;
  recent.set(ip, [...times, Date.now()]);
  return true;
}

const suffix = () => crypto.getRandomValues(new Uint32Array(1))[0]!.toString(36);

async function createWithSponsor(sponsorId: string, sponsorKey: string, publicKey: string): Promise<string> {
  const accountId = `g${suffix()}.${sponsorId}`;
  await sponsorSend(sponsorKey, sponsorId, accountId, [actions.createAccount(), actions.transfer(nearToYocto(GUEST_NEAR)), actions.addFullAccessKey(PublicKey.fromString(publicKey))]);
  return accountId;
}

async function createWithFaucet(publicKey: string): Promise<string | null> {
  const accountId = `lien-guest-${suffix()}.testnet`;
  const response = await fetch(FAUCET, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ newAccountId: accountId, newAccountPublicKey: publicKey }),
  }).catch(() => null);
  return response?.ok ? accountId : null;
}

/** Fee top-ups per guest account per day, so one guest cannot drain the sponsor. */
const FEE_TOPUPS_PER_DAY = 4;
const feeTopUps = new Map<string, number[]>();

function feeTopUpAllowed(accountId: string): boolean {
  const cutoff = Date.now() - 86_400_000;
  const times = (feeTopUps.get(accountId) ?? []).filter((t) => t > cutoff);
  if (times.length >= FEE_TOPUPS_PER_DAY) return false;
  feeTopUps.set(accountId, [...times, Date.now()]);
  return true;
}

/**
 * Tops up a guest of this sponsor: enough to start a business, or, for "fees", a little
 * NEAR when the guest has spent what it started with on network fees. Returns the NEAR
 * sent ("0" when the guest already had enough), or null when the request is refused.
 */
async function topUp(sponsorId: string, sponsorKey: string, accountId: string, reason: "business" | "fees"): Promise<string | null> {
  if (!accountId.endsWith(`.${sponsorId}`) || !/^g[a-z0-9]+\./.test(accountId)) return null;
  const { amount } = await acrossNodes(RPC_URLS.testnet, (url) => new JsonRpcProvider({ url }).viewAccount({ accountId }));
  const [floor, gift] = reason === "fees" ? ([FEES_MINIMUM, FEES_NEAR] as const) : ([BUSINESS_MINIMUM, BUSINESS_NEAR] as const);
  if (BigInt(amount) >= floor) return "0";
  if (reason === "fees" && !feeTopUpAllowed(accountId)) return null;
  await sponsorSend(sponsorKey, sponsorId, accountId, [actions.transfer(nearToYocto(gift))]);
  return gift;
}

export async function POST(request: Request) {
  if (process.env.NEXT_PUBLIC_NETWORK === "mainnet") {
    return NextResponse.json({ error: "Guest accounts only exist on testnet." }, { status: 404 });
  }
  const body = (await request.json().catch(() => null)) as { publicKey?: string; topUp?: string; reason?: string } | null;
  if (!body?.topUp && (!body?.publicKey || !KEY.test(body.publicKey))) {
    return NextResponse.json({ error: "Invalid account request." }, { status: 400 });
  }
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  if (!allowed(ip)) {
    return NextResponse.json({ error: "You have used several test accounts recently. Try again in an hour, or connect a wallet." }, { status: 429 });
  }

  const { GUEST_SPONSOR_ACCOUNT: sponsorId, GUEST_SPONSOR_KEY: sponsorKey } = process.env;
  if (body.topUp) {
    if (!sponsorId || !sponsorKey) return NextResponse.json({ error: "Connect a wallet with some testnet NEAR to start a business." }, { status: 404 });
    const reason = body.reason === "fees" ? "fees" : "business";
    const sent = await topUp(sponsorId, sponsorKey, body.topUp, reason).catch(() => null);
    return sent !== null
      ? NextResponse.json({ ok: true, near: sent })
      : NextResponse.json({ error: "Your test account could not get more NEAR right now. Try again later, or connect a wallet." }, { status: 502 });
  }
  if (!body.publicKey) return NextResponse.json({ error: "Invalid account request." }, { status: 400 });

  try {
    const accountId = sponsorId && sponsorKey
      ? await createWithSponsor(sponsorId, sponsorKey, body.publicKey)
      : await createWithFaucet(body.publicKey);
    if (accountId) return NextResponse.json({ accountId });
  } catch (error) {
    console.error("guest sponsor failed", error);
  }
  return NextResponse.json({ error: "Free test accounts are unavailable right now. Try again soon, or connect a wallet." }, { status: 502 });
}
