import { NextResponse } from "next/server";

// A thin server side to the NEAR Intents 1Click API, so a partner key is never
// sent to the browser.

const API = "https://1click.chaindefuser.com/v0";
const USDC_NEAR = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const LIVE = process.env.NEXT_PUBLIC_NETWORK === "mainnet";
const ACCOUNT = /^[a-z0-9._-]{2,64}$/;

const headers = (): HeadersInit => ({
  "content-type": "application/json",
  ...(process.env.ONECLICK_JWT ? { "x-api-key": process.env.ONECLICK_JWT } : {}),
});

const CHAIN_NAMES: Record<string, string> = {
  base: "Base", arb: "Arbitrum", eth: "Ethereum", sol: "Solana", pol: "Polygon", op: "Optimism", bsc: "BNB Chain",
};

/** Routes people are likely to pay from: stablecoins on the big chains. */
export async function GET() {
  const response = await fetch(`${API}/tokens`, { next: { revalidate: 300 }, signal: AbortSignal.timeout(10_000) }).catch(() => null);
  if (!response?.ok) return NextResponse.json({ routes: [] });
  const tokens = (await response.json()) as Array<{ assetId: string; symbol: string; blockchain: string }>;
  const routes = tokens
    .filter((t) => (t.symbol === "USDC" || t.symbol === "USDT") && t.blockchain in CHAIN_NAMES)
    .sort((a, b) => a.symbol.localeCompare(b.symbol) || CHAIN_NAMES[a.blockchain]!.localeCompare(CHAIN_NAMES[b.blockchain]!))
    .map((t) => ({ assetId: t.assetId, label: `${t.symbol} on ${CHAIN_NAMES[t.blockchain]}` }));
  return NextResponse.json({ routes });
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { originAsset?: string; amount?: string; refundTo?: string; recipient?: string } | null;
  if (!body?.originAsset || !/^\d+$/.test(body.amount ?? "") || !body.refundTo || !ACCOUNT.test(body.recipient ?? "")) {
    return NextResponse.json({ error: "Check the amount and addresses." }, { status: 400 });
  }
  const response = await fetch(`${API}/quote`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      // Testnet accounts do not exist on mainnet Intents, so there it is a price only.
      dry: !LIVE,
      swapType: "EXACT_OUTPUT",
      slippageTolerance: 100,
      originAsset: body.originAsset,
      depositType: "ORIGIN_CHAIN",
      destinationAsset: USDC_NEAR,
      amount: body.amount,
      // EVM addresses are accepted in any letter case; the route API wants them in one.
      refundTo: /^0x[0-9a-f]{40}$/i.test(body.refundTo.trim()) ? body.refundTo.trim().toLowerCase() : body.refundTo.trim(),
      refundType: "ORIGIN_CHAIN",
      recipient: LIVE ? body.recipient : "intents.near",
      recipientType: "DESTINATION_CHAIN",
      deadline: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    }),
    signal: AbortSignal.timeout(15_000),
  }).catch(() => null);
  if (!response) return NextResponse.json({ error: "NEAR Intents could not be reached." }, { status: 502 });
  const data = (await response.json().catch(() => null)) as { message?: string; quote?: { amountInFormatted: string; timeEstimate: number; depositAddress?: string } } | null;
  if (!response.ok || !data?.quote) {
    const message = data?.message ?? "";
    const friendly = /refundTo/i.test(message) ? "That refund address does not look right for this chain." : message || "No route is available right now.";
    return NextResponse.json({ error: friendly }, { status: 422 });
  }
  const { amountInFormatted, timeEstimate, depositAddress } = data.quote;
  return NextResponse.json({ amountInFormatted, timeEstimate, depositAddress, preview: !LIVE });
}
