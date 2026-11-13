import type { Metadata, Viewport } from "next";
import { Epilogue, JetBrains_Mono } from "next/font/google";
import { TxProvider } from "@/components/Tx";
import { WalletProvider } from "@/lib/wallet/WalletProvider";
import "./globals.css";

const epilogue = Epilogue({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-epilogue",
  display: "swap",
});

const mono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-jetbrains",
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: "Lien: loans to AI businesses, repaid from every sale", template: "%s · Lien" },
  description:
    "Lend to AI businesses on NEAR that hold no keys and run sealed code. Lenders are paid first from each sale, and anyone can foreclose a business that stops paying.",
  metadataBase: new URL("https://lien-five.vercel.app"),
  openGraph: { type: "website", siteName: "Lien", images: [{ url: "/site/share.jpg", width: 1440, height: 900 }] },
  twitter: { card: "summary_large_image", images: ["/site/share.jpg"] },
};

export const viewport: Viewport = { themeColor: "#0c0a08", colorScheme: "dark" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${epilogue.variable} ${mono.variable}`}>
      <body>
        <WalletProvider>
          <TxProvider>{children}</TxProvider>
        </WalletProvider>
      </body>
    </html>
  );
}
