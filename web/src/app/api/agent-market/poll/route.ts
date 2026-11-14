import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { readFacts } from "../../../../lib/near/rpc";
import { pollOnce } from "../../../../lib/agentMarket/worker";

// The fallback for a missed webhook: serves every in_progress Agent Market assignment.
// The marketplace itself says a hire.created can be lost, so call this now and then:
//   curl -H "Authorization: Bearer $CRON_SECRET" https://lien-five.vercel.app/api/agent-market/poll
// No Vercel cron is configured (Hobby allows one run a day); an external scheduler can call it.

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(header: string | null, secret: string | undefined): boolean {
  if (!secret || !header) return false;
  const a = Buffer.from(header);
  const b = Buffer.from(`Bearer ${secret}`);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(request: Request) {
  if (!authorized(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const token = process.env.AGENT_MARKET_TOKEN;
  if (!token) return NextResponse.json({ error: "AGENT_MARKET_TOKEN is not set" }, { status: 503 });
  try {
    const outcomes = await pollOnce({ token, readFacts, log: console.log });
    return NextResponse.json({ served: outcomes.length, outcomes });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 502 });
  }
}
