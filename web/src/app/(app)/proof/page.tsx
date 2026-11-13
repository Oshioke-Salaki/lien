import type { Metadata } from "next";
import { ProofScreen } from "@/components/screens/ProofScreen";

export const metadata: Metadata = { title: "Proof" };

export default function Page() {
  return <ProofScreen />;
}
