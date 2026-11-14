import { after, NextResponse } from "next/server";
import { readFacts } from "../../../../lib/near/rpc";
import { DELIVERY_HEADER, EVENT_HEADER, SIGNATURE_HEADER, TIMESTAMP_HEADER, verifySignature } from "../../../../lib/agentMarket/signature";
import { handleEvent, planFor, type WebhookEvent } from "../../../../lib/agentMarket/worker";

// Sentinel's webhook on NEAR's Agent Market (see lib/agentMarket/worker.ts for the doc sources).
// The signature is checked on the raw bytes before anything else; an unsigned or stale request
// gets 401. A verified event is answered 200 at once, as the docs ask, and the job itself
// (chain reads, start, submit) runs in after(), inside this route's maxDuration.

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  const rawBody = new Uint8Array(await request.arrayBuffer());
  const ok = verifySignature({
    secret: process.env.AGENT_MARKET_WEBHOOK_SECRET,
    timestamp: request.headers.get(TIMESTAMP_HEADER),
    signature: request.headers.get(SIGNATURE_HEADER),
    rawBody,
  });
  if (!ok) return NextResponse.json({ error: "bad signature" }, { status: 401 });

  let body: WebhookEvent;
  try {
    body = JSON.parse(new TextDecoder().decode(rawBody)) as WebhookEvent;
  } catch {
    // Signed but unreadable: acknowledge, so the marketplace does not retry something we can never read.
    return NextResponse.json({ ok: true, ignored: "unreadable body" });
  }
  const event = body.event ?? request.headers.get(EVENT_HEADER) ?? "";
  const delivery = request.headers.get(DELIVERY_HEADER) ?? "";
  const plan = planFor({ ...body, event });
  if (plan.kind === "none") return NextResponse.json({ ok: true, event });

  const token = process.env.AGENT_MARKET_TOKEN;
  if (!token) {
    console.error(`agent-market: ${event} ${delivery} received but AGENT_MARKET_TOKEN is not set; the poller can serve it later`);
    return NextResponse.json({ ok: true, event });
  }
  after(async () => {
    try {
      await handleEvent({ token, readFacts, log: console.log }, { ...body, event });
    } catch (error) {
      console.error(`agent-market: ${event} ${delivery} failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  });
  return NextResponse.json({ ok: true, event });
}
