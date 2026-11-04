"use client";

import type { ReactNode } from "react";
import { accountUrl } from "@/lib/config";
import { shortAccount } from "@/lib/format";
import { isAlert, STANDING_LABEL, type Standing } from "@/lib/status";

export function Panel({ title, aside, children, id, className = "" }: { title?: ReactNode; aside?: ReactNode; children: ReactNode; id?: string; className?: string }) {
  return (
    <section className={`panel ${className}`} id={id}>
      {title ? (
        <div className="panel-head">
          <h2>{title}</h2>
          {aside ? <div className="text-[14px] muted">{aside}</div> : null}
        </div>
      ) : null}
      <div className="panel-body">{children}</div>
    </section>
  );
}

export function StandingLabel({ standing }: { standing: Standing }) {
  const alert = isAlert(standing);
  return (
    <span className="inline-flex items-center gap-2 whitespace-nowrap" data-standing={standing}>
      <span
        aria-hidden
        className="h-[9px] w-[9px] rounded-full"
        style={{ background: alert ? "var(--data)" : standing === "current" ? "var(--ok)" : standing === "funding" ? "#000" : "#b8bcb8" }}
      />
      {STANDING_LABEL[standing]}
    </span>
  );
}

export function AccountLink({ id, max }: { id: string; max?: number }) {
  return (
    <a className="link" href={accountUrl(id)} target="_blank" rel="noreferrer" title={id}>{shortAccount(id, max)}</a>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="panel p-6">
      <p className="mb-3 text-[17px]">{message}</p>
      {onRetry ? <button type="button" className="btn btn-secondary btn-sm" onClick={onRetry}>Try again</button> : null}
    </div>
  );
}

export function Skeleton({ className }: { className: string }) {
  return <div className={`skeleton ${className}`} aria-hidden />;
}

export function Bar({ value, tone = "var(--data)", label }: { value: number; tone?: string; label: string }) {
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <div role="img" aria-label={label} className="h-[6px] w-full bg-[#e9ece9]">
      <div className="h-full origin-left transition-[width] duration-700" style={{ width: `${clamped}%`, background: tone, transitionTimingFunction: "var(--ease-out)" }} />
    </div>
  );
}
