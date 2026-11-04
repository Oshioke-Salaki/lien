import type { Metadata } from "next";
import { MarketScreen } from "@/components/screens/MarketScreen";

export const metadata: Metadata = { title: "Market" };

export default function Page() {
  return <MarketScreen />;
}
