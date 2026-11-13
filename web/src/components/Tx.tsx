"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { txUrl } from "@/lib/config";
import type { TxRequest } from "@/lib/near/actions";
import { friendlyError, type TxResult } from "@/lib/near/outcome";
import { useWallet } from "@/lib/wallet/WalletProvider";

export type Prepared = { summary: string; prepare: () => Promise<TxRequest> };

type Notice = { id: number; tone: "pending" | "done" | "error"; title: string; text: string; hash?: string };

type TxContextValue = {
  /**
   * Sends a transaction, tells the user how it went, and returns the result.
   * Pass a function when the request needs a network read first: a failure there
   * then shows as a notice like any other, instead of a click that does nothing.
   */
  run: (request: TxRequest | Prepared, options?: { requiredOn?: string; done?: string; pending?: string }) => Promise<TxResult | null>;
  busy: boolean;
};

const TxContext = createContext<TxContextValue | null>(null);

function describeThrown(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/reject|cancel|denied|closed/i.test(message)) return "You cancelled the request. Nothing was sent.";
  return friendlyError(message);
}

export function TxProvider({ children }: { children: ReactNode }) {
  const { send } = useWallet();
  const [notices, setNotices] = useState<Notice[]>([]);
  const [busy, setBusy] = useState(false);
  const counter = useRef(0);

  const dismiss = useCallback((id: number) => setNotices((all) => all.filter((n) => n.id !== id)), []);

  const run = useCallback<TxContextValue["run"]>(async (request, options = {}) => {
    const id = ++counter.current;
    setBusy(true);
    setNotices((all) => [...all.slice(-2), { id, tone: "pending", title: request.summary, text: options.pending ?? "Waiting for the network. This usually takes a few seconds." }]);
    const finish = (notice: Omit<Notice, "id">) => {
      setNotices((all) => all.map((n) => (n.id === id ? { id, ...notice } : n)));
      if (notice.tone === "done") setTimeout(() => dismiss(id), 9_000);
    };
    try {
      const ready = "prepare" in request ? await request.prepare() : request;
      const result = await send(ready, options.requiredOn);
      if (result.ok) finish({ tone: "done", title: options.done ?? `${request.summary}: done`, text: "Confirmed on chain.", hash: result.hash });
      else finish({ tone: "error", title: `${request.summary} did not go through`, text: result.error ?? "The transaction failed. Nothing was taken that was not given back.", hash: result.hash });
      return result;
    } catch (error) {
      finish({ tone: "error", title: `${request.summary} did not go through`, text: describeThrown(error) });
      return null;
    } finally {
      setBusy(false);
    }
  }, [send, dismiss]);

  return (
    <TxContext.Provider value={{ run, busy }}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed right-4 bottom-4 left-4 z-50 flex flex-col items-end gap-2 sm:left-auto sm:w-[400px]">
        {notices.map((notice) => (
          <div key={notice.id} role={notice.tone === "error" ? "alert" : "status"} data-tone={notice.tone} className="notice pointer-events-auto w-full">
            <NoticeIcon tone={notice.tone} />
            <div className="min-w-0 flex-1">
              <p className="font-medium">{notice.title}</p>
              <p className="mt-[2px] text-[14px] text-[var(--ink-2)]">
                {notice.text}
                {notice.hash ? (
                  <>
                    {" "}
                    <a className="link" href={txUrl(notice.hash)} target="_blank" rel="noreferrer">View transaction</a>
                  </>
                ) : null}
              </p>
            </div>
            {notice.tone !== "pending" ? (
              <button type="button" className="-m-2 grid h-10 w-10 shrink-0 place-items-center rounded-full text-[var(--muted)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--ink)]" onClick={() => dismiss(notice.id)} aria-label="Dismiss">
                <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden><path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
              </button>
            ) : null}
          </div>
        ))}
      </div>
    </TxContext.Provider>
  );
}

function NoticeIcon({ tone }: { tone: Notice["tone"] }) {
  if (tone === "pending") return <span className="spinner mt-[3px]" aria-hidden />;
  const ok = tone === "done";
  return (
    <span aria-hidden className="mt-[1px] grid h-[22px] w-[22px] shrink-0 place-items-center rounded-full" style={{ background: ok ? "rgb(127 211 160 / 0.16)" : "rgb(255 122 110 / 0.16)", color: ok ? "var(--ok)" : "var(--danger)" }}>
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{ok ? <path d="M2.5 6.2l2.3 2.3 4.7-5" /> : <path d="M6 3v3.6M6 9h.01" />}</svg>
    </span>
  );
}

export function useTx() {
  const value = useContext(TxContext);
  if (!value) throw new Error("useTx needs a TxProvider");
  return value;
}

/** Shows children while connected, or the way to connect when not. */
export function ConnectGate({ children, reason, quiet = false }: { children: ReactNode; reason: string; quiet?: boolean }) {
  const { account, ready } = useWallet();
  if (!ready) return <div className="skeleton h-11" />;
  if (account) return <>{children}</>;
  // `quiet` is for screens that already show the connect buttons once.
  return (
    <div className="space-y-3">
      <p className="flex items-center gap-2 text-[14px] text-[var(--ink-2)]">
        <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden fill="none" stroke="var(--muted)" strokeWidth="1.4"><rect x="2.5" y="6" width="9" height="6" rx="1.5" /><path d="M4.5 6V4.5a2.5 2.5 0 0 1 5 0V6" /></svg>
        {reason}
      </p>
      {quiet ? null : <ConnectButtons />}
    </div>
  );
}

export function ConnectButtons({ compact = false }: { compact?: boolean }) {
  const { connect, startGuest } = useWallet();
  const [state, setState] = useState<"idle" | "guest" | "wallet">("idle");
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const attempt = async (which: "guest" | "wallet", action: () => Promise<void>) => {
    setState(which);
    setError(null);
    try {
      await action();
    } catch (thrown) {
      if (mounted.current) setError(thrown instanceof Error ? thrown.message : "That did not work. Try again.");
    } finally {
      if (mounted.current) setState("idle");
    }
  };

  return (
    <div className={compact ? "flex flex-col gap-2 [&>.btn]:w-full [&>.btn]:whitespace-nowrap [&>.btn]:px-3 [&>.btn]:text-[14px]" : "flex flex-wrap gap-2"}>
      <button type="button" className="btn btn-primary" disabled={state !== "idle"} onClick={() => attempt("wallet", connect)}>
        {state === "wallet" ? "Opening…" : "Connect a wallet"}
      </button>
      <GuestButton busy={state === "guest"} disabled={state !== "idle"} onClick={() => attempt("guest", startGuest)} />
      {error ? <p role="alert" className="w-full text-[14px] text-[var(--danger)]">{error}</p> : null}
    </div>
  );
}

function GuestButton({ busy, disabled, onClick }: { busy: boolean; disabled: boolean; onClick: () => void }) {
  if (process.env.NEXT_PUBLIC_NETWORK === "mainnet") return null;
  return (
    <button type="button" className="btn btn-secondary" disabled={disabled} onClick={onClick}>
      {busy ? "Creating your account…" : "Use a free test account"}
    </button>
  );
}
