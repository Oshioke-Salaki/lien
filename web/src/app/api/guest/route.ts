import { NextResponse } from "next/server";
import { Account, JsonRpcProvider, nearToYocto, type KeyPairString } from "near-api-js";
import { RPC_URLS } from "@/lib/config";

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
  const provider = new JsonRpcProvider({ url: RPC_URLS.testnet[0]! });
  const sponsor = new Account(sponsorId, provider, sponsorKey as KeyPairString);
  const accountId = `g${suffix()}.${sponsorId}`;
  await sponsor.createSubAccount({ accountOrPrefix: accountId, publicKey, nearToTransfer: nearToYocto(GUEST_NEAR) });
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

/** Tops up a guest of this sponsor who is about to start a business. */
async function topUp(sponsorId: string, sponsorKey: string, accountId: string): Promise<boolean> {
  if (!accountId.endsWith(`.${sponsorId}`) || !/^g[a-z0-9]+\./.test(accountId)) return false;
  const provider = new JsonRpcProvider({ url: RPC_URLS.testnet[0]! });
  const { amount } = await provider.viewAccount({ accountId });
  if (BigInt(amount) < BUSINESS_MINIMUM) {
    const sponsor = new Account(sponsorId, provider, sponsorKey as KeyPairString);
    await sponsor.transfer({ receiverId: accountId, amount: nearToYocto(BUSINESS_NEAR) });
  }
  return true;
}

export async function POST(request: Request) {
  if (process.env.NEXT_PUBLIC_NETWORK === "mainnet") {
    return NextResponse.json({ error: "Guest accounts only exist on testnet." }, { status: 404 });
  }
  const body = (await request.json().catch(() => null)) as { publicKey?: string; topUp?: string } | null;
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
    const done = await topUp(sponsorId, sponsorKey, body.topUp).catch(() => false);
    return done ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "Your test account could not be topped up. Connect a wallet instead." }, { status: 502 });
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
