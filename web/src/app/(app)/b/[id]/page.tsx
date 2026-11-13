import type { Metadata } from "next";
import { BusinessScreen } from "@/components/screens/BusinessScreen";
import { getBusiness } from "@/lib/near/rpc";

// Read on the server (cached ten seconds) so the page arrives with its figures, then kept live.
/** Server rendering waits at most this long for the chain; after that the page renders and loads live in the browser. */
const within = <T,>(work: Promise<T>, ms = 4_000) =>
  Promise.race([work, new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), ms))]).catch(() => undefined);

export const revalidate = 10;

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  return { title: decodeURIComponent(id).split(".")[0] };
}

export default async function Page({ params }: Props) {
  const { id } = await params;
  const decoded = decodeURIComponent(id);
  const initial = await within(getBusiness(decoded));
  return <BusinessScreen id={decoded} initial={initial} />;
}
