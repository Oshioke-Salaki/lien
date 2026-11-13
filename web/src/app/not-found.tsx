import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Page not found" };

export default function NotFound() {
  return (
    <main className="grid min-h-svh place-items-center px-6">
      <div className="max-w-[520px] space-y-5 text-center">
        <p className="num text-[64px] leading-none font-medium tracking-[-0.03em] text-[var(--accent)]">404</p>
        <h1 className="text-[28px] font-medium tracking-[-0.02em]">There&rsquo;s no Lien business or page at that address</h1>
        <p className="text-[17px] text-[var(--ink-2)]">The link may be old, or the address may be mistyped. Every Lien business has an address ending in .v1.lien-13569.testnet, and you can find them all in the market.</p>
        <div className="flex flex-wrap justify-center gap-3">
          <Link href="/market" className="btn btn-primary">Open the market</Link>
          <a href="/" className="btn btn-secondary">Go to the home page</a>
        </div>
      </div>
    </main>
  );
}
