"use client";

import { useEffect, useMemo, useState } from "react";
import { useTx } from "@/components/Tx";
import { Panel } from "@/components/ui";
import { useLive } from "@/hooks/useLive";
import { isTestnet } from "@/lib/config";
import { money } from "@/lib/format";
import { amountProblem, parseMoney } from "@/lib/amounts";
import { forward } from "@/lib/near/actions";
import { tokenBalance } from "@/lib/near/rpc";
import type { Business } from "@/lib/near/types";
import { useWallet } from "@/lib/wallet/WalletProvider";
import { AmountField, TextField } from "./fields";

type Route = { assetId: string; label: string };
type Quote = { amountInFormatted: string; timeEstimate: number; depositAddress?: string; preview: boolean };

/** Income from any chain reaches the waterfall through this business's inbox. */
export function IntentsPanel({ business: b, refresh }: { business: Business; refresh: () => Promise<void> }) {
  const { account } = useWallet();
  const { busy, run } = useTx();
  const inbox = useLive(() => tokenBalance(b.collector).catch(() => 0n), `inbox:${b.collector}`, 10_000);
  const [routes, setRoutes] = useState<Route[]>([]);
  const [origin, setOrigin] = useState("");
  const [amountText, setAmountText] = useState("10");
  const [refundTo, setRefundTo] = useState("");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [state, setState] = useState<"idle" | "loading">("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/quote")
      .then((r) => r.json())
      .then((data: { routes?: Route[] }) => {
        if (alive && data.routes?.length) {
          setRoutes(data.routes);
          setOrigin(data.routes[0]!.assetId);
        }
      })
      .catch(() => undefined);
    return () => { alive = false; };
  }, []);

  const wanted = useMemo(() => parseMoney(amountText), [amountText]);
  const pending = inbox.data ?? 0n;

  const getQuote = async () => {
    if (!wanted || !refundTo.trim()) return;
    setState("loading");
    setError(null);
    setQuote(null);
    try {
      const response = await fetch("/api/quote", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ originAsset: origin, amount: wanted.toString(), refundTo: refundTo.trim(), recipient: b.collector }),
      });
      const body = (await response.json()) as Quote & { error?: string };
      if (!response.ok) throw new Error(body.error ?? "No route is available right now.");
      setQuote(body);
    } catch (thrown) {
      setError(thrown instanceof Error ? thrown.message : "No route is available right now.");
    } finally {
      setState("idle");
    }
  };

  return (
    <Panel title="Pay this business from another blockchain">
      <div className="space-y-3" data-testid="intents">
        {isTestnet ? (
          <p className="rounded-[10px] bg-[var(--accent-tint)] px-4 py-3 text-[14px] leading-snug" data-testid="intents-preview-note">
            Preview: these prices come live from NEAR Intents on the real network, to show how payment from another blockchain will work. On the test network nothing is sent and no real money moves.
          </p>
        ) : null}
        <p className="text-[15px] leading-snug text-[var(--ink-2)]">On the real network, a customer on another blockchain, like Arbitrum or Base, can pay this business in its own currency. NEAR Intents converts it, the money arrives at the business&rsquo;s payment address, and it is split between lenders and the business like any other sale.</p>
        <p className="text-[14px] break-all"><span className="muted">Payment address: </span><code>{b.collector}</code></p>

        {pending > 0n ? (
          <div className="callout">
            <p className="mb-2">{money(pending)} has arrived at its payment address and is waiting to be split.</p>
            <button type="button" className="btn btn-primary btn-sm" data-testid="forward" disabled={busy || !account} onClick={async () => { await run(forward(b.collector), { done: "Split between lenders and the business" }); await Promise.all([inbox.refresh(), refresh()]); }}>Split it now</button>
          </div>
        ) : null}

        {routes.length ? (
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void getQuote(); }}>
            <label className="field">
              <span>Pay from</span>
              <select className="input" value={origin} data-testid="intents-origin" onChange={(e) => { setOrigin(e.target.value); setQuote(null); }}>
                {routes.map((r) => <option key={r.assetId} value={r.assetId}>{r.label}</option>)}
              </select>
            </label>
            <AmountField label="Business receives" unit={isTestnet ? "dollars" : "USDC"} value={amountText} onChange={setAmountText} error={amountProblem(amountText)} />
            <TextField label="Your address on that chain, for refunds" testId="intents-refund" value={refundTo} onChange={setRefundTo} placeholder="0x…" />
            <button type="submit" className="btn btn-secondary w-full" data-testid="intents-quote" disabled={state === "loading" || !wanted || !refundTo.trim()}>{state === "loading" ? "Finding a route…" : isTestnet ? "See a live price (nothing is sent)" : "Get a live quote"}</button>
          </form>
        ) : <p className="text-[14px] muted">Routes could not be loaded just now.</p>}

        {error ? <p role="alert" className="hint" data-error="true">{error}</p> : null}
        {quote ? (
          <div className="inset appear text-[15px]" data-testid="intents-result">
            <p>You send {quote.amountInFormatted}. It arrives in about {quote.timeEstimate} seconds.</p>
            {quote.depositAddress ? (
              <p className="mt-2 break-all">Send to: <code>{quote.depositAddress}</code></p>
            ) : null}
            {quote.preview ? (
              <p className="mt-2 muted">This is a real price from the main network. Lien is on the test network here, so sending is switched off.</p>
            ) : null}
          </div>
        ) : null}
        {isTestnet ? <p className="text-[14px] muted">On testnet you can also send test dollars straight to its payment address.</p> : null}
      </div>
    </Panel>
  );
}
