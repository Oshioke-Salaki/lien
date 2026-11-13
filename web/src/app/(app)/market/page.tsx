import type { Metadata } from "next";
import { MarketScreen } from "@/components/screens/MarketScreen";
import { cachedMarket } from "@/lib/snapshotCache";

/** Server rendering waits at most this long for the chain; after that the page renders and loads live in the browser. */
const within = <T,>(work: Promise<T>, ms = 4_000) =>
  Promise.race([work, new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), ms))]).catch(() => undefined);

export const metadata: Metadata = { title: "Market" };
// The server reads the market at most every ten seconds, so the page arrives with real rows;
// the browser keeps them live from there.
export const revalidate = 10;

export default async function Page() {
  const initial = await within(cachedMarket());
  return <MarketScreen initial={initial} />;
}
