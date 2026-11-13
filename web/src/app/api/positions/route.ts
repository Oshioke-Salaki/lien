import { NextResponse } from "next/server";
import { isAccountId } from "@/lib/accounts";
import { cachedPositions } from "@/lib/snapshotCache";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** Everything one account holds across Lien, read once on the server and cached a few seconds. */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const account = params.get("account")?.trim().toLowerCase() ?? "";
  if (!isAccountId(account)) return NextResponse.json({ error: "That is not a NEAR account." }, { status: 400 });
  // Hints from the browser: businesses to read first (unread last time), and test runs it dealt with.
  const ids = (name: string) => (params.get(name) ?? "").split(",").map((id) => id.trim().toLowerCase()).filter(isAccountId).slice(0, 50);
  try {
    const snapshot = await cachedPositions(account, { first: ids("first"), also: ids("also") });
    return NextResponse.json(snapshot, { headers: { "cache-control": "private, max-age=3" } });
  } catch {
    return NextResponse.json({ error: "Your positions could not be read from the network." }, { status: 502 });
  }
}
