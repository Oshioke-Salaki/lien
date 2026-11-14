import { NextResponse } from "next/server";
import { buildQuoteRequest, friendlyQuoteError, ONECLICK_API, oneClickHeaders, readQuote } from "@/lib/intents";

// A thin server side to the NEAR Intents 1Click API, so a partner key (ONECLICK_JWT, optional)
// is never sent to the browser. The request and the wording live in lib/intents.ts.

const MAINNET = process.env.NEXT_PUBLIC_NETWORK === "mainnet";

const CHAIN_NAMES: Record<string, string> = {
  base: "Base", arb: "Arbitrum", eth: "Ethereum", sol: "Solana", pol: "Polygon", op: "Optimism", bsc: "BNB Chain",
};

/** Routes people are likely to pay from: stablecoins on the big chains. */
export async function GET() {
  const response = await fetch(`${ONECLICK_API}/tokens`, { next: { revalidate: 300 }, signal: AbortSignal.timeout(10_000) }).catch(() => null);
  if (!response?.ok) return NextResponse.json({ routes: [] });
  const tokens = (await response.json()) as Array<{ assetId: string; symbol: string; blockchain: string }>;
  const routes = tokens
    .filter((t) => (t.symbol === "USDC" || t.symbol === "USDT") && t.blockchain in CHAIN_NAMES)
    .sort((a, b) => a.symbol.localeCompare(b.symbol) || CHAIN_NAMES[a.blockchain]!.localeCompare(CHAIN_NAMES[b.blockchain]!))
    .map((t) => ({ assetId: t.assetId, label: `${t.symbol} on ${CHAIN_NAMES[t.blockchain]}`, symbol: t.symbol }));
  return NextResponse.json({ routes });
}

/**
 * A 1Click quote paying this business. `dry: true` is a price only; otherwise 1Click returns a real
 * deposit address whose status /api/quote/status follows. On testnet the app never sends to it
 * (`sendingOff`); see buildQuoteRequest for why.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const built = buildQuoteRequest(body ?? {}, { mainnet: MAINNET, now: Date.now() });
  if (!built.ok) return NextResponse.json({ error: built.error }, { status: 400 });
  const response = await fetch(`${ONECLICK_API}/quote`, {
    method: "POST",
    headers: oneClickHeaders(process.env.ONECLICK_JWT),
    body: JSON.stringify(built.request),
    signal: AbortSignal.timeout(15_000),
    cache: "no-store",
  }).catch(() => null);
  if (!response) return NextResponse.json({ error: "NEAR Intents could not be reached." }, { status: 502 });
  const data = (await response.json().catch(() => null)) as { message?: string } | null;
  const quote = response.ok ? readQuote(built.request, data) : null;
  if (!quote) return NextResponse.json({ error: friendlyQuoteError(data?.message) }, { status: 422 });
  return NextResponse.json({ ...quote, sendingOff: !MAINNET, preview: !MAINNET });
}
