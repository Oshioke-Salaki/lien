"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { txUrl } from "@/lib/config";
import type { TxRequest } from "@/lib/near/actions";
import { friendlyError, type TxResult } from "@/lib/near/outcome";
import { useWallet } from "@/lib/wallet/WalletProvider";

export type Prepared = { summary: string; prepare: () => Promise<TxRequest> };

type Notice = { id: number; tone: "pending" | "done" | "error"; text: string; hash?: string };

type TxContextValue = {
  /**
   * Sends a transaction, tells the user how it went, and returns the result.
   * Pass a function when the request needs a network read first: a failure there
   * then shows as a notice like any other, instead of a click that does nothing.
   */
  run: (request: TxRequest | Prepared, options?: { requiredOn?: string; done?: string }) => Promise<TxResult | null>;
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
    setNotices((all) => [...all.slice(-2), { id, tone: "pending", text: `${request.summary}: waiting for the network` }]);
    const finish = (notice: Omit<Notice, "id">) => {
      setNotices((all) => all.map((n) => (n.id === id ? { id, ...notice } : n)));
      if (notice.tone === "done") setTimeout(() => dismiss(id), 9_000);
    };
    try {
      const ready = "prepare" in request ? await request.prepare() : request;
      const result = await send(ready, options.requiredOn);
      if (result.ok) finish({ tone: "done", text: options.done ?? `${request.summary}: done`, hash: result.hash });
      else finish({ tone: "error", text: result.error ?? "The transaction failed.", hash: result.hash });
      return result;
    } catch (error) {
      finish({ tone: "error", text: describeThrown(error) });
      return null;
    } finally {
      setBusy(false);
    }
  }, [send, dismiss]);

  return (
    <TxContext.Provider value={{ run, busy }}>
      {children}
      <div aria-live="polite" className="fixed right-4 bottom-4 left-4 z-50 flex flex-col items-end gap-2 sm:left-auto sm:w-[400px]">
        {notices.map((notice) => (
          <div key={notice.id} role={notice.tone === "error" ? "alert" : "status"} data-tone={notice.tone} className="notice w-full">
            <p className="min-w-0 flex-1">
              {notice.text}
              {notice.hash ? (
                <>
                  {" "}
                  <a className="link" href={txUrl(notice.hash)} target="_blank" rel="noreferrer">View transaction</a>
                </>
              ) : null}
            </p>
            {notice.tone !== "pending" ? (
              <button type="button" className="shrink-0 underline-offset-2 hover:underline" onClick={() => dismiss(notice.id)} aria-label="Dismiss">Close</button>
            ) : <span className="spinner" aria-hidden />}
          </div>
        ))}
      </div>
    </TxContext.Provider>
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
  if (!ready) return <p className="muted">Checking your wallet…</p>;
  if (account) return <>{children}</>;
  // `quiet` is for screens that already show the connect buttons once.
  return (
    <div className="space-y-3">
      <p className="text-[15px] muted">{reason}</p>
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
    <div className={compact ? "flex flex-col gap-2 [&>.btn]:whitespace-normal [&>.btn]:px-2 [&>.btn]:text-[15px]" : "flex flex-wrap gap-2"}>
      <button type="button" className="btn btn-primary" disabled={state !== "idle"} onClick={() => attempt("wallet", connect)}>
        {state === "wallet" ? "Opening…" : "Connect a wallet"}
      </button>
      <GuestButton busy={state === "guest"} disabled={state !== "idle"} onClick={() => attempt("guest", startGuest)} />
      {error ? <p role="alert" className="w-full text-[var(--danger)]">{error}</p> : null}
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
