import { NextResponse } from "next/server";

const FAUCET = "https://helper.nearprotocol.com/account";
const NAME = /^lien-guest-[a-z0-9]{1,12}\.testnet$/;
const KEY = /^ed25519:[1-9A-HJ-NP-Za-km-z]{32,64}$/;

/** Creates a testnet account through the public faucet, which browsers cannot call directly. */
export async function POST(request: Request) {
  if (process.env.NEXT_PUBLIC_NETWORK === "mainnet") {
    return NextResponse.json({ error: "Guest accounts only exist on testnet." }, { status: 404 });
  }
  const body = (await request.json().catch(() => null)) as { accountId?: string; publicKey?: string } | null;
  if (!body?.accountId || !NAME.test(body.accountId) || !body.publicKey || !KEY.test(body.publicKey)) {
    return NextResponse.json({ error: "Invalid account request." }, { status: 400 });
  }
  const response = await fetch(FAUCET, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ newAccountId: body.accountId, newAccountPublicKey: body.publicKey }),
  }).catch(() => null);
  if (!response?.ok) {
    return NextResponse.json({ error: "The testnet faucet is busy. Try again in a minute, or connect a wallet." }, { status: 502 });
  }
  return NextResponse.json({ accountId: body.accountId });
}
