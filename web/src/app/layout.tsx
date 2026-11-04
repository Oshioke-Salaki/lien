import type { Metadata } from "next";
import { Literata } from "next/font/google";
import { TxProvider } from "@/components/Tx";
import { WalletProvider } from "@/lib/wallet/WalletProvider";
import "./globals.css";

const literata = Literata({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  style: ["normal", "italic"],
  variable: "--font-literata",
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: "Lien: lend to AI businesses and repossess them", template: "%s · Lien" },
  description:
    "Lien lends to AI businesses that run sealed code on NEAR. Every sale pays lenders first, and a business that stops paying changes owners without stopping.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={literata.variable}>
      <body>
        <WalletProvider>
          <TxProvider>{children}</TxProvider>
        </WalletProvider>
      </body>
    </html>
  );
}
