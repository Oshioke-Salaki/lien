import { NextResponse } from "next/server";
import { cachedMarket } from "@/lib/snapshotCache";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** The market as one cached read: businesses, lifetime figures and recent activity. */
export async function GET() {
  try {
    const snapshot = await cachedMarket();
    return NextResponse.json(snapshot, { headers: { "cache-control": "public, s-maxage=5, stale-while-revalidate=20", "access-control-allow-origin": "*" } });
  } catch {
    return NextResponse.json({ error: "The network could not be reached." }, { status: 502 });
  }
}
