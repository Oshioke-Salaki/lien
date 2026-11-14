import { NextResponse } from "next/server";
import { ONECLICK_API, oneClickHeaders, readStatus } from "@/lib/intents";

export const dynamic = "force-dynamic";

const ADDRESS = /^[\w.:\-]{8,128}$/;

/** Where a 1Click payment stands, by its deposit address: GET /v0/status. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const depositAddress = url.searchParams.get("depositAddress") ?? "";
  const depositMemo = url.searchParams.get("depositMemo");
  if (!ADDRESS.test(depositAddress) || (depositMemo !== null && !/^[\w-]{1,128}$/.test(depositMemo))) {
    return NextResponse.json({ error: "That is not a deposit address." }, { status: 400 });
  }
  const query = new URLSearchParams({ depositAddress, ...(depositMemo ? { depositMemo } : {}) });
  const response = await fetch(`${ONECLICK_API}/status?${query}`, {
    headers: oneClickHeaders(process.env.ONECLICK_JWT),
    signal: AbortSignal.timeout(10_000),
    cache: "no-store",
  }).catch(() => null);
  if (!response) return NextResponse.json({ error: "NEAR Intents could not be reached." }, { status: 502 });
  if (response.status === 404) return NextResponse.json({ error: "NEAR Intents does not know this deposit address." }, { status: 404 });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data) return NextResponse.json({ error: "NEAR Intents could not say where this payment stands." }, { status: 502 });
  return NextResponse.json(readStatus(data), { headers: { "cache-control": "no-store" } });
}
