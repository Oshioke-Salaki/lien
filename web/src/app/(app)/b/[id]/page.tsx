import type { Metadata } from "next";
import { BusinessScreen } from "@/components/screens/BusinessScreen";
import { getBusiness } from "@/lib/near/rpc";

// Read on the server (cached ten seconds) so the page arrives with its figures, then kept live.
export const revalidate = 10;

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  return { title: decodeURIComponent(id).split(".")[0] };
}

export default async function Page({ params }: Props) {
  const { id } = await params;
  const decoded = decodeURIComponent(id);
  const initial = await getBusiness(decoded).catch(() => undefined);
  return <BusinessScreen id={decoded} initial={initial} />;
}
