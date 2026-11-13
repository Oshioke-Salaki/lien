"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { accountUrl } from "@/lib/config";
import { shortAccount } from "@/lib/format";
import { STANDING_LABEL, type Standing } from "@/lib/status";

export function Panel({ title, aside, children, id, className = "", featured = false }: { title?: ReactNode; aside?: ReactNode; children: ReactNode; id?: string; className?: string; featured?: boolean }) {
  return (
    <section className={`panel ${className}`} id={id} data-featured={featured || undefined}>
      {title ? (
        <div className="panel-head">
          <h2>{title}</h2>
          {aside ? <div className="text-right text-[14px] muted">{aside}</div> : null}
        </div>
      ) : null}
      <div className="panel-body">{children}</div>
    </section>
  );
}

/** One colour per kind of state: calm, waiting on lenders, or needing someone to act. */
export const STANDING_TONE: Record<Standing, string> = {
  "no-loan": "var(--muted)",
  funding: "var(--accent)",
  current: "var(--ok)",
  behind: "var(--warn)",
  foreclosable: "var(--danger)",
  foreclosed: "var(--danger)",
  auction: "var(--warn)",
};

export function StandingLabel({ standing }: { standing: Standing }) {
  return (
    <span className="chip" data-standing={standing} style={{ color: STANDING_TONE[standing] }}>
      <span aria-hidden className="chip-dot" />
      <span className="text-[var(--ink)]">{STANDING_LABEL[standing]}</span>
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
    <div role="alert" className="panel flex flex-col items-start gap-4 p-6 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-3">
        <span aria-hidden className="mt-[3px] grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[rgb(255_122_110_/_0.14)] text-[14px] font-semibold text-[var(--danger)]">!</span>
        <p className="text-[17px] leading-snug">{message}</p>
      </div>
      {onRetry ? <button type="button" className="btn btn-secondary btn-sm shrink-0" onClick={onRetry}>Try again</button> : null}
    </div>
  );
}

/** What to show where data will be: always with the one thing to do next. */
export function EmptyState({ title, body, action }: { title: string; body?: string; action?: { href: string; label: string } }) {
  return (
    <div className="flex flex-col items-start gap-3 rounded-[12px] bg-[var(--surface-2)] p-6">
      <p className="text-[17px] font-medium">{title}</p>
      {body ? <p className="max-w-[56ch] text-[15px] text-[var(--ink-2)]">{body}</p> : null}
      {action ? <Link href={action.href} className="btn btn-secondary btn-sm mt-1">{action.label}</Link> : null}
    </div>
  );
}

export function Skeleton({ className }: { className: string }) {
  return <div className={`skeleton ${className}`} aria-hidden />;
}

export function Bar({ value, tone = "var(--accent)", label }: { value: number; tone?: string; label: string }) {
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <div role="img" aria-label={label} className="track">
      <i style={{ width: `${clamped}%`, background: tone }} />
    </div>
  );
}

/** A page's title row: what this is, one line on it, and its main action. */
export function PageHead({ title, lead, action }: { title: ReactNode; lead?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
      <div className="min-w-0">
        <h1 className="text-[clamp(30px,3.4vw,40px)] leading-[1.05] font-medium tracking-[-0.025em]">{title}</h1>
        {lead ? <div className="mt-2 max-w-[64ch] text-[17px] leading-snug text-[var(--ink-2)]">{lead}</div> : null}
      </div>
      {action}
    </div>
  );
}
