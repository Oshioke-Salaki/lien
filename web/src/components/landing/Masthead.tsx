"use client";

import Image from "next/image";
import Link from "next/link";
import { Mark } from "@/components/Mark";
import { deployment, isTestnet } from "@/lib/config";
import { useMarketPulse } from "./useMarketPulse";

const NAV = [
  { href: "/market", label: "Market" },
  { href: "#how", label: "How it works" },
  { href: "#try", label: "Try it" },
  { href: "#questions", label: "Questions" },
];

function Tile({ tone, className = "", children }: { tone: string; className?: string; children: React.ReactNode }) {
  return <div className={`flex flex-col justify-between overflow-hidden p-3 lg:p-4 ${className}`} style={{ background: tone }}>{children}</div>;
}

function Photo({ src, alt, className = "", position = "center", drift = false, priority = false }: { src: string; alt: string; className?: string; position?: string; drift?: boolean; priority?: boolean }) {
  return (
    <div className={`relative overflow-hidden bg-[#222] ${className}`}>
      <Image src={src} alt={alt} fill priority={priority} sizes="(max-width: 1024px) 66vw, 34vw" className={`object-cover grayscale contrast-[1.05] ${drift ? "drift" : ""}`} style={{ objectPosition: position }} />
    </div>
  );
}

export function Masthead() {
  const pulse = useMarketPulse();
  const jobs = pulse.data?.jobs;
  const hash = deployment.sentinel?.hash ?? "";
  return (
    <section className="flex min-h-svh flex-col">
      <header className="flex items-stretch bg-white text-[15px]">
        <Link href="/" className="flex items-center gap-2 bg-black py-3 pr-5 pl-[var(--margin)] text-[18px] font-medium text-white">
          <Mark size={22} /> Lien
        </Link>
        <p className="hidden items-center bg-[var(--accent)] px-4 lg:flex lg:w-[calc(42%-104px)]">Loans to AI businesses, on the public record</p>
        <nav aria-label="Main" className="ml-auto flex items-center gap-4 pr-[var(--margin)] sm:gap-6">
          {NAV.map((item, i) => (
            <Link key={item.href} href={item.href} className={`hover:underline ${i === 0 ? "" : "hidden md:inline"}`}>{item.label}</Link>
          ))}
          <Link href="/market" className="btn btn-sm btn-accent">Open the app</Link>
        </nav>
      </header>

      {/* The filing: real documents of the trade beside live facts from the chain. */}
      <div className="grid h-[38svh] grid-cols-3 grid-rows-2 lg:h-[46svh] lg:grid-cols-6">
        <Photo className="col-span-2" src="/pictures/sheriff-s-sale.jpg" alt="A courthouse wall covered in identical sheriff's sale notices" position="35% 45%" drift priority />
        <Tile tone="var(--accent)" className="lg:row-span-2">
          <p className="text-[clamp(3rem,7vw,7rem)] leading-none font-medium tracking-[-0.03em]">0</p>
          <p className="text-[15px] leading-snug lg:text-[17px]">keys on any business. Nobody can spend its money directly.</p>
        </Tile>
        <Photo className="hidden lg:block" src="/pictures/couple-of-metallic-padlocks-on-old-door.jpg" alt="Two old metal padlocks on a door frame" />
        <Tile tone="var(--yellow)" className="hidden lg:flex">
          <p className="num text-[clamp(2rem,3.4vw,3.5rem)] leading-none font-medium tracking-[-0.02em]" data-testid="pulse-jobs">{jobs ?? "…"}</p>
          <p className="text-[15px] leading-snug">jobs sold from a secure enclave, live on {isTestnet ? "testnet" : "NEAR"}</p>
        </Tile>
        <Photo className="hidden lg:block" src="/pictures/sheriff-s-sale.jpg" alt="Close view of a printed sheriff's sale notice" position="15% 60%" />
        <Tile tone="#000" className="text-[#f4f4f4]">
          <p className="text-[15px] leading-snug">Pinned build</p>
          <code className="block text-[13px] leading-snug break-all" data-ui>{hash.slice(0, 40)}</code>
        </Tile>
        <Tile tone="var(--sage)" className="col-span-1">
          <p className="text-[15px] leading-snug lg:text-[17px]">Every sale pays lenders first.</p>
        </Tile>
        <Photo className="hidden lg:block" src="/pictures/key-to-the-open-door.jpg" alt="An old key in a door" />
        <div className="hidden bg-white p-3 lg:col-span-2 lg:block lg:p-4" data-ui>
          <p className="text-[13px] muted">Latest delivered job{pulse.data?.latestBusiness ? `, ${pulse.data.latestBusiness}` : ""}</p>
          <p className="mt-1 truncate text-[15px] font-medium">{pulse.data?.latest?.input ?? "Reading the chain…"}</p>
          <pre className="mt-1 text-[13px] leading-snug whitespace-pre-wrap text-[var(--muted)]"><code>{pulse.data?.latest?.report?.slice(0, 96) ?? ""}</code></pre>
        </div>
      </div>

      <div className="grid flex-1 content-center gap-6 px-[var(--margin)] py-8 lg:grid-cols-[calc(42%-var(--margin))_1fr] lg:gap-0 lg:py-6">
        <h1 className="lines text-[13vw] leading-[1.02] font-medium tracking-[-0.03em] lg:order-2 lg:text-[7.4vw]">
          <span className="line"><span data-line style={{ "--i": 0 } as React.CSSProperties}>Lend to AI.</span></span>
          <span className="line"><span data-line style={{ "--i": 1 } as React.CSSProperties}>Repossess it.</span></span>
        </h1>
        <div className="after-lines max-w-[44ch] space-y-5 pr-6 lg:order-1 lg:self-end">
          <p className="text-[18px] leading-snug lg:text-[20px]">
            Lien lends to AI businesses that run sealed code on NEAR. Every sale pays lenders first. A business that stops paying changes owners, and keeps serving its customers.
          </p>
          <Link href="/market" className="btn btn-accent min-h-[52px] px-6 text-[17px]">See the live loans</Link>
        </div>
      </div>
    </section>
  );
}
