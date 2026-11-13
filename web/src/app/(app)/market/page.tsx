import type { Metadata } from "next";
import { MarketScreen } from "@/components/screens/MarketScreen";
import { listBusinesses } from "@/lib/near/rpc";

export const metadata: Metadata = { title: "Market" };
// The server reads the market at most every ten seconds, so the page arrives with real rows;
// the browser keeps them live from there.
export const revalidate = 10;

export default async function Page() {
  const initial = await listBusinesses().catch(() => undefined);
  return <MarketScreen initial={initial} />;
}
