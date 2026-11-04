import type { Metadata } from "next";
import { BusinessScreen } from "@/components/screens/BusinessScreen";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  return { title: decodeURIComponent(id).split(".")[0] };
}

export default async function Page({ params }: Props) {
  const { id } = await params;
  return <BusinessScreen id={decodeURIComponent(id)} />;
}
