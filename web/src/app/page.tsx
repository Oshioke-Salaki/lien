import type { Metadata } from "next";
import Link from "next/link";
import { HowItWorks } from "@/components/landing/HowItWorks";
import { Masthead } from "@/components/landing/Masthead";
import { Proof } from "@/components/landing/Proof";
import { Questions } from "@/components/landing/Questions";
import { Showcase } from "@/components/landing/Showcase";
import { Simulator } from "@/components/landing/Simulator";
import { RevealObserver } from "@/components/Reveal";
import { REPO_URL } from "@/lib/config";

export const metadata: Metadata = { title: "Lien: lend to AI businesses, and repossess them" };

export default function Page() {
  return (
    <>
      <RevealObserver />
      <main>
        <Masthead />
        <Showcase />
        <HowItWorks />
        <Simulator />
        <Proof />
        <Questions />
        <section className="flex min-h-[90svh] flex-col justify-between bg-black px-[var(--margin)] pt-10 pb-[120px] text-white" aria-labelledby="close-title">
          <h2 id="close-title" className="text-[15vw] leading-[0.92] font-medium tracking-[-0.03em] lg:text-[10vw]" data-reveal>
            <span className="block">Lend to it.</span>
            <span className="block">Or own it.</span>
          </h2>
          <div className="grid items-end gap-6 lg:grid-cols-12">
            <p className="text-[18px] lg:col-span-5 lg:text-[20px]" data-reveal>Every loan and every foreclosure is open to read. You can run the whole thing on testnet in a few minutes, with no wallet to install.</p>
            <Link href="/market" className="btn btn-accent min-h-[56px] px-8 text-[17px] lg:col-span-3 lg:col-start-10">Open the market</Link>
          </div>
        </section>
      </main>
      <footer className="overflow-hidden bg-[var(--accent)] px-[var(--margin)] pt-14 pb-8 text-black">
        <p className="text-[34vw] leading-[0.8] font-medium tracking-[-0.05em] lg:text-[26vw]" aria-hidden>Lien</p>
        <div className="mt-[72px] grid gap-10 lg:grid-cols-12">
          <ul className="space-y-1 text-[26px] leading-tight font-medium lg:col-span-5 lg:text-[34px]">
            <li><Link className="hover:underline" href="/market">Market</Link></li>
            <li><Link className="hover:underline" href="/create">Start a business</Link></li>
            <li><Link className="hover:underline" href="/guide">Developer guide</Link></li>
            <li><a className="hover:underline" href={REPO_URL}>Source code</a></li>
          </ul>
          <div className="space-y-3 text-[15px] lg:col-span-6 lg:col-start-7">
            <p>Built at NEAR HACKATHON, 2026. Testnet only. Not audited. Nothing here is financial advice.</p>
            <p className="credits">
              Pictures, shown in greyscale: <a className="link" href="https://www.flickr.com/photos/30647744@N00/490600652">“Sheriff&apos;s Sale”</a> by dmuth, <a className="link" href="https://creativecommons.org/licenses/by-sa/2.0/">CC BY-SA 2.0</a>;{" "}
              <a className="link" href="https://www.flickr.com/photos/10361931@N06/4268291295">“Couple of metallic padlocks on old door frame”</a> by Horia Varlan, <a className="link" href="https://creativecommons.org/licenses/by/2.0/">CC BY 2.0</a>;{" "}
              <a className="link" href="https://www.flickr.com/photos/11309626@N02/2309847575">“Key to the open door”</a> by Tawheed Manzoor, <a className="link" href="https://creativecommons.org/licenses/by/2.0/">CC BY 2.0</a>. All via Flickr.
            </p>
          </div>
        </div>
      </footer>
    </>
  );
}
