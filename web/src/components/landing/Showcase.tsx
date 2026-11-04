"use client";

import Link from "next/link";
import { useState } from "react";
import { ReportCard } from "@/components/business/ReportCard";
import { deployment } from "@/lib/config";
import { amount, symbol } from "@/lib/format";
import { useMarketPulse } from "./useMarketPulse";

export function Showcase() {
  const [input, setInput] = useState("is usdc.near safe to pay?");
  const pulse = useMarketPulse();
  const latest = pulse.data?.latest;
  const message = JSON.stringify({ action: "job", input });
  return (
    <section className="grid grid-cols-[minmax(0,1fr)] lg:min-h-[90svh] lg:grid-cols-2" aria-labelledby="showcase-title">
      <div className="flex min-w-0 flex-col justify-between gap-10 bg-black px-[var(--margin)] py-14 text-[#f4f4f4] lg:py-16">
        <h2 id="showcase-title" className="text-[length:var(--step-head)] leading-[1.05] font-medium tracking-[-0.02em]" data-reveal>A customer pays. Sealed code works.</h2>
        <div data-reveal style={{ "--d": 1 } as React.CSSProperties}>
          <label htmlFor="showcase-input" className="mb-3 block text-[18px]">What they ask the business to check</label>
          <input id="showcase-input" value={input} onChange={(e) => setInput(e.target.value)} className="w-full border-0 border-b-2 border-[#f4f4f4] bg-transparent py-2 text-[22px] outline-none focus:border-[var(--accent)]" />
          <pre className="mt-6 overflow-x-auto text-[15px] leading-relaxed text-[#cfcfcf]"><code>{`ft_transfer_call({
  receiver_id: "sentinel.${deployment.registry.split(".")[0]}…",
  amount: "250000",
  msg: ${JSON.stringify(message)},
})`}</code></pre>
          <p className="mt-6 text-[18px]">The contract holds the payment. OutLayer runs the one build the contract has pinned, inside an Intel TDX enclave. It takes about 15 seconds, and if the run fails the money goes back.</p>
        </div>
      </div>
      <div className="flex min-w-0 flex-col justify-between gap-10 bg-white px-[var(--margin)] py-14 lg:py-16">
        <p className="text-[length:var(--step-head)] leading-[1.05] font-medium tracking-[-0.02em]" data-reveal>The chain keeps the receipt.</p>
        <div className="panel max-w-[520px] p-5" data-ui data-reveal>
          <p className="mb-3 text-[14px] muted">Delivered on chain{latest ? ` for ${amount(latest.paid)} ${symbol}` : ""}. This is the newest real job.</p>
          {latest ? <ReportCard raw={latest.report} /> : <p className="muted">{pulse.error ? "The chain could not be reached just now." : "Reading the chain…"}</p>}
          <dl className="dl mt-4 text-[14px]">
            <dt>Asked</dt><dd className="max-w-[260px] truncate">{latest?.input ?? "-"}</dd>
            <dt>Build that ran</dt><dd><code>{latest ? `${latest.wasm_hash.slice(0, 16)}…` : "-"}</code></dd>
          </dl>
          <Link href="/market" className="link mt-3 inline-block text-[15px]">Buy one yourself</Link>
        </div>
      </div>
    </section>
  );
}
