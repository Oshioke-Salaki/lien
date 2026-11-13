import { NextResponse } from "next/server";
import { isAccountId } from "@/lib/accounts";
import { latestAttestation } from "@/lib/near/proof";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * The newest secure-computer proof among a business's recent transactions. Looked up here so
 * the browser doesn't probe a dozen transactions that have none (each a 404 in its console).
 * Always answers 200: { attestation } or { attestation: null } when none could be found.
 */
export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("account")?.trim().toLowerCase() ?? "";
  if (!isAccountId(id)) return NextResponse.json({ error: "That is not a NEAR account." }, { status: 400 });
  const attestation = await latestAttestation(id).catch(() => null);
  return NextResponse.json({ attestation }, { headers: { "cache-control": "public, s-maxage=30, stale-while-revalidate=120" } });
}
