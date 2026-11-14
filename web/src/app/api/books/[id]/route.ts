import { NextResponse } from "next/server";
import { cachedBooks, isBusinessId } from "@/lib/booksRead";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const NOT_A_BUSINESS = /UNKNOWN_ACCOUNT|INVALID_ACCOUNT|CodeDoesNotExist|does not exist|MethodNotFound|MethodResolveError/i;

/**
 * A business's books as JSON: income, balance sheet, customers, loans and policy, computed
 * only from its contract's views read at one block. Every amount is { units, usd }: token
 * base units (6 decimals) and the same figure as the app shows it.
 */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = decodeURIComponent((await params).id);
  const cors = { "access-control-allow-origin": "*" };
  if (!isBusinessId(id)) return NextResponse.json({ error: "Not a Lien business on this deployment." }, { status: 404, headers: cors });
  try {
    const books = await cachedBooks(id);
    return NextResponse.json(books, { headers: { ...cors, "cache-control": "public, s-maxage=5, stale-while-revalidate=20" } });
  } catch (error) {
    const missing = NOT_A_BUSINESS.test(String(error instanceof Error ? error.message : error));
    return NextResponse.json(
      { error: missing ? `There is no Lien business at ${id}.` : "The network could not be reached." },
      { status: missing ? 404 : 502, headers: cors },
    );
  }
}
