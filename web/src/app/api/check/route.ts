import { NextResponse } from "next/server";
import { isAccountId } from "@/lib/accounts";
import { freeCheck } from "@/lib/mcp";

// The free check for the app: the same answer as the MCP tool check_account (Lien's extended
// check, built on Sentinel's rules, with its signals and their sources). Reads only; no key.

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const account = params.get("account")?.trim().toLowerCase() ?? "";
  const payer = params.get("payer")?.trim().toLowerCase() || undefined;
  if (!isAccountId(account) || (payer && !isAccountId(payer))) return NextResponse.json({ error: "That is not a NEAR account." }, { status: 400 });
  try {
    return NextResponse.json(await freeCheck(account, payer), { headers: { "cache-control": "private, max-age=30" } });
  } catch {
    return NextResponse.json({ error: "The account could not be read from the network." }, { status: 502 });
  }
}
