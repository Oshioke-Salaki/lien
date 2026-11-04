import { NextResponse } from "next/server";
import { listBusinesses } from "@/lib/near/rpc";

export const dynamic = "force-dynamic";

/** Every business, read from the chain. A convenience: the chain is the source. */
export async function GET() {
  try {
    return NextResponse.json({ agents: await listBusinesses() }, { headers: { "access-control-allow-origin": "*" } });
  } catch {
    return NextResponse.json({ error: "The network could not be reached." }, { status: 502 });
  }
}
