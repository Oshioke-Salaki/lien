import type { Metadata } from "next";
import { CreateScreen } from "@/components/screens/CreateScreen";

export const metadata: Metadata = { title: "Start a business" };

export default function Page() {
  return <CreateScreen />;
}
