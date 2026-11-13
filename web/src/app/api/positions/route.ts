import { NextResponse } from "next/server";
import { isAccountId } from "@/lib/accounts";
import { cachedPositions } from "@/lib/snapshotCache";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** Everything one account holds across Lien, read once on the server and cached a few seconds. */
export async function GET(request: Request) {
  const account = new URL(request.url).searchParams.get("account")?.trim().toLowerCase() ?? "";
  if (!isAccountId(account)) return NextResponse.json({ error: "That is not a NEAR account." }, { status: 400 });
  try {
    const snapshot = await cachedPositions(account);
    return NextResponse.json(snapshot, { headers: { "cache-control": "private, max-age=3" } });
  } catch {
    return NextResponse.json({ error: "Your positions could not be read from the network." }, { status: 502 });
  }
}
