"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTx } from "@/components/Tx";
import { Panel } from "@/components/ui";
import { useLive } from "@/hooks/useLive";
import { isTestnet } from "@/lib/config";
import { money } from "@/lib/format";
import { amountProblem, parseMoney } from "@/lib/amounts";
import {
  describeStatus, HAPPY_PATH, INTENT_STATUSES, INTENTS_EXPLORER, isFinalStatus,
  type IntentStatus, type QuoteView, type StatusTone, type StatusView,
} from "@/lib/intents";
import { forward } from "@/lib/near/actions";
import { tokenBalance } from "@/lib/near/rpc";
import type { Business } from "@/lib/near/types";
import { useWallet } from "@/lib/wallet/WalletProvider";
import { AmountField, TextField } from "./fields";

type Route = { assetId: string; label: string; symbol?: string };
type Quote = QuoteView & { sendingOff: boolean; preview: boolean };

const TONE: Record<StatusTone, string> = { waiting: "var(--accent)", done: "var(--ok)", attention: "var(--warn)", bad: "var(--danger)" };
const POLL_MS = 5_000;

/** Income from any chain reaches the waterfall through this business's inbox. */
export function IntentsPanel({ business: b, refresh }: { business: Business; refresh: () => Promise<void> }) {
  const { account } = useWallet();
  const { busy, run } = useTx();
  const inbox = useLive(() => tokenBalance(b.collector).catch(() => 0n), `inbox:${b.collector}`, 10_000);
  const [routes, setRoutes] = useState<Route[]>([]);
  const [routesState, setRoutesState] = useState<"loading" | "ready" | "failed">("loading");
  const [origin, setOrigin] = useState("");
  const [amountText, setAmountText] = useState("10");
  const [refundTo, setRefundTo] = useState("");
  const [dryRun, setDryRun] = useState(false);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [state, setState] = useState<"idle" | "loading">("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/quote")
      .then((r) => r.json())
      .then((data: { routes?: Route[] }) => {
        if (!alive) return;
        if (data.routes?.length) {
          setRoutes(data.routes);
          setOrigin(data.routes[0]!.assetId);
          setRoutesState("ready");
        } else setRoutesState("failed");
      })
      .catch(() => { if (alive) setRoutesState("failed"); });
    return () => { alive = false; };
  }, []);

  const wanted = useMemo(() => parseMoney(amountText), [amountText]);
  const pending = inbox.data ?? 0n;
  const route = routes.find((r) => r.assetId === origin);

  const getQuote = async () => {
    if (!wanted || !refundTo.trim()) return;
    setState("loading");
    setError(null);
    setQuote(null);
    try {
      const response = await fetch("/api/quote", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ originAsset: origin, amount: wanted.toString(), refundTo: refundTo.trim(), recipient: b.collector, dry: dryRun }),
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

  const reset = () => { setQuote(null); setError(null); };
  const ctx = quote ? { send: `${quote.amountInFormatted}${route?.symbol ? ` ${route.symbol}` : ""}`, refundTo: quote.refundTo, receive: wanted ? money(wanted) : undefined } : {};

  return (
    <Panel title="Pay this business from another blockchain">
      <div className="space-y-3" data-testid="intents">
        {isTestnet ? (
          <p className="rounded-[10px] bg-[var(--accent-tint)] px-4 py-3 text-[14px] leading-snug" data-testid="intents-preview-note">
            Lien runs on NEAR&rsquo;s test network. These quotes, deposit addresses and statuses come live from NEAR Intents on the real networks, but sending is switched off here: <b>do not send real money to any address shown</b>. It would not reach this test business.
          </p>
        ) : null}
        <p className="text-[15px] leading-snug text-[var(--ink-2)]">A customer on another blockchain, like Arbitrum or Base, pays in its own currency. NEAR Intents (1Click) gives a deposit address on that chain, converts the payment to USDC on NEAR, and delivers it to the business&rsquo;s payment address, where it is split between lenders and the business like any other sale. If it cannot complete, the money goes back to the customer&rsquo;s refund address. Nobody holds it in between.</p>
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
              <select className="input" value={origin} data-testid="intents-origin" onChange={(e) => { setOrigin(e.target.value); reset(); }}>
                {routes.map((r) => <option key={r.assetId} value={r.assetId}>{r.label}</option>)}
              </select>
            </label>
            <AmountField label="Business receives" unit={isTestnet ? "dollars" : "USDC"} value={amountText} onChange={(v) => { setAmountText(v); reset(); }} error={amountProblem(amountText)} />
            <TextField label="Your address on that chain, for refunds" testId="intents-refund" value={refundTo} onChange={(v) => { setRefundTo(v); reset(); }} placeholder="0x…" />
            <label className="flex items-start gap-3 text-[14px] leading-snug" data-testid="intents-dry-toggle">
              <input type="checkbox" className="mt-[3px]" checked={dryRun} onChange={(e) => { setDryRun(e.target.checked); reset(); }} />
              <span><b>Dry run</b> <span className="muted">(for judges): ask 1Click for a price only, with no deposit address, then step through every status a payment can reach, including refunds and failures.</span></span>
            </label>
            <button type="submit" className="btn btn-secondary w-full" data-testid="intents-quote" disabled={state === "loading" || !wanted || !refundTo.trim()}>
              {state === "loading" ? "Finding a route…" : dryRun ? "Get a dry-run price" : isTestnet ? "Get a real quote and deposit address (nothing is sent)" : "Get a quote and deposit address"}
            </button>
          </form>
        ) : routesState === "loading" ? (
          <p className="text-[14px] muted" data-testid="intents-loading">Loading live routes from NEAR Intents…</p>
        ) : <p className="text-[14px] muted">Routes could not be loaded just now. Reload the page to try again.</p>}

        {error ? <p role="alert" className="hint" data-error="true">{error}</p> : null}
        {quote ? (
          <div className="inset appear space-y-2 text-[15px]" data-testid="intents-result" data-dry={quote.dry}>
            <p>You send {ctx.send}. The business receives {ctx.receive ?? quote.amountOutFormatted}. It arrives in about {quote.timeEstimate} seconds.</p>
            {quote.depositAddress ? (
              <>
                <p className="break-all">Send to: <code data-testid="intents-deposit">{quote.depositAddress}</code>{quote.depositMemo ? <> with memo <code>{quote.depositMemo}</code></> : null}</p>
                {quote.deadline ? <p className="text-[14px] muted">NEAR Intents watches this address until {new Date(quote.deadline).toLocaleString()}.</p> : null}
                <p className="text-[14px] muted">If anything goes wrong, the money goes back to <code className="break-all">{quote.refundTo}</code>.</p>
              </>
            ) : (
              <p className="text-[14px] muted">Dry run: 1Click returned a price only. No deposit address was created, so there is nothing to send to.</p>
            )}
            {quote.sendingOff ? (
              <p className="rounded-[10px] px-3 py-2 text-[14px] leading-snug" style={{ background: "color-mix(in srgb, var(--warn) 18%, transparent)" }} data-testid="intents-sending-off">
                <b>Do not send anything.</b> This is a real price{quote.depositAddress ? " and a real deposit address" : ""} from the main network. Lien is on the test network here, so sending is switched off: on the main network this payment would be credited to the name <code className="break-all">{quote.recipient}</code> inside NEAR Intents, which no one can withdraw to this test business.
              </p>
            ) : null}
            {quote.depositAddress ? (
              <StatusTracker key={quote.depositAddress} depositAddress={quote.depositAddress} depositMemo={quote.depositMemo} ctx={ctx} />
            ) : (
              <DryRunWalkthrough ctx={ctx} />
            )}
          </div>
        ) : null}
        {isTestnet ? <p className="text-[14px] muted">On testnet you can also send test dollars straight to its payment address.</p> : null}
      </div>
    </Panel>
  );
}

type Ctx = { send?: string; refundTo?: string; receive?: string };

/** Follows a real deposit address on 1Click's status API until it settles. */
function StatusTracker({ depositAddress, depositMemo, ctx }: { depositAddress: string; depositMemo: string | null; ctx: Ctx }) {
  const [view, setView] = useState<StatusView | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [checkedAt, setCheckedAt] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const query = new URLSearchParams({ depositAddress, ...(depositMemo ? { depositMemo } : {}) });
    const tick = async () => {
      let final = false;
      try {
        const response = await fetch(`/api/quote/status?${query}`, { cache: "no-store" });
        const body = (await response.json()) as StatusView & { error?: string };
        if (!alive) return;
        if (!response.ok) setProblem(body.error ?? "Could not read the status just now.");
        else {
          setProblem(null);
          setView(body);
          final = body.status !== "UNKNOWN" && isFinalStatus(body.status);
        }
        setCheckedAt(Date.now());
      } catch {
        if (alive) setProblem("Could not read the status just now.");
      }
      if (alive && !final) timer = setTimeout(tick, POLL_MS);
    };
    void tick();
    return () => { alive = false; if (timer) clearTimeout(timer); };
  }, [depositAddress, depositMemo]);

  return (
    <div className="space-y-2 pt-1" data-testid="intents-status">
      <p className="text-[13px] muted">Live status from NEAR Intents, checked every {POLL_MS / 1000} seconds{checkedAt ? ` (last at ${new Date(checkedAt).toLocaleTimeString()})` : ""}.</p>
      {view ? <StatusCard status={view.status} ctx={{ ...ctx, refunded: view.refundedFormatted, refundReason: view.refundReason }} view={view} /> : problem ? null : <p className="text-[14px] muted">Checking…</p>}
      {problem ? <p className="hint" data-error="true">{problem}</p> : null}
      <p className="text-[13px] muted">Look it up yourself: search <code className="break-all">{depositAddress}</code> on the <a className="underline" href={INTENTS_EXPLORER} target="_blank" rel="noreferrer">NEAR Intents explorer</a>.</p>
    </div>
  );
}

/** Dry run: the same status card, driven by the judge instead of by a real deposit. */
function DryRunWalkthrough({ ctx }: { ctx: Ctx }) {
  const [status, setStatus] = useState<IntentStatus>("PENDING_DEPOSIT");
  const [playing, setPlaying] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const play = () => {
    if (timer.current) clearTimeout(timer.current);
    setPlaying(true);
    const step = (i: number) => {
      setStatus(HAPPY_PATH[i]!);
      if (i + 1 < HAPPY_PATH.length) timer.current = setTimeout(() => step(i + 1), 1_500);
      else setPlaying(false);
    };
    step(0);
  };

  return (
    <div className="space-y-2 pt-1" data-testid="intents-dryrun">
      <p className="text-[13px] muted">Simulated, not from a real deposit. Pick any status 1Click can report to see what the customer is told.</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn btn-secondary btn-sm" onClick={play} disabled={playing} data-testid="intents-dryrun-play">Play a successful payment</button>
        {INTENT_STATUSES.map((s) => (
          <button key={s} type="button" className="chip cursor-pointer" aria-pressed={status === s} data-testid={`intents-sim-${s}`} style={status === s ? { outline: "2px solid var(--accent)" } : undefined}
            onClick={() => { if (timer.current) clearTimeout(timer.current); setPlaying(false); setStatus(s); }}>
            {s}
          </button>
        ))}
      </div>
      <StatusCard status={status} ctx={{ ...ctx, refunded: status === "REFUNDED" ? ctx.send : null }} />
    </div>
  );
}

function StatusCard({ status, ctx, view }: { status: IntentStatus | "UNKNOWN"; ctx: Ctx & { refunded?: string | null; refundReason?: string | null }; view?: StatusView }) {
  const words = describeStatus(status, ctx);
  const at = HAPPY_PATH.indexOf(status as IntentStatus);
  return (
    <div className="rounded-[10px] border border-[var(--line)] px-3 py-3" data-testid="intents-status-card" data-status={status}>
      <ol className="mb-2 flex flex-wrap gap-x-3 gap-y-1 text-[12px]" aria-label="Steps">
        {HAPPY_PATH.map((s, i) => (
          <li key={s} className={at >= i ? "" : "muted"}>{at > i || (at === i && status === "SUCCESS") ? "✓ " : at === i ? "● " : "○ "}{describeStatus(s).label}</li>
        ))}
      </ol>
      <p className="flex flex-wrap items-center gap-2">
        <span className="chip" style={{ color: TONE[words.tone] }}><span aria-hidden className="chip-dot" /><span className="text-[var(--ink)]">{words.label}</span></span>
        <code className="text-[12px] muted">{view?.rawStatus || status}</code>
      </p>
      <p className="mt-2 text-[14px] leading-snug" data-testid="intents-status-meaning">{words.meaning}</p>
      {view && (view.depositedFormatted || view.originTxs.length || view.destinationTxs.length) ? (
        <ul className="mt-2 space-y-1 text-[13px] muted break-all">
          {view.depositedFormatted ? <li>Deposited: {view.depositedFormatted}</li> : null}
          {view.originTxs.map((h) => <li key={h}>Payment transaction: <code>{h}</code></li>)}
          {view.destinationTxs.map((h) => <li key={h}>Delivery transaction: <code>{h}</code></li>)}
        </ul>
      ) : null}
    </div>
  );
}
