"use client";

import { useEffect, useState } from "react";
import { accountUrl } from "@/lib/config";
import type { Verdict } from "@/lib/risk";
import type { Signal } from "@/lib/signals";
import { VerdictBadge } from "./ReportCard";

/** What /api/check returns: the same answer as the MCP tool check_account. */
type FreeCheckResult = {
  target: string;
  score: number;
  verdict: Verdict;
  reported: boolean;
  sentinel_rules: { score: number; verdict: Verdict };
  signals: Signal[];
};

const LABEL: Record<Signal["id"], string> = {
  reported: "Shared blocklist",
  account_age: "Account age",
  recent_code_change: "Code changes",
  prior_interactions: "Your history with it",
};
const STATUS: Record<Signal["status"], string> = { found: "Found", clear: "Clear", unavailable: "Unavailable", not_applicable: "Not applicable" };

/** A link a person can open for a signal's source: an explorer page, or the contract it was read from. */
const sourceHref = (source: string) => (source.startsWith("https://") ? source : /^[a-z0-9._-]+\.(testnet|near)\b/.test(source) ? accountUrl(source.split(" ")[0]!) : null);

/**
 * Lien's extended check, free, before anything is paid: Sentinel's rules plus the shared
 * blocklist, account age, recent code changes and prior dealings with the connected account,
 * each with its source. Shown for a single account name, a moment after typing stops.
 */
export function FreeCheck({ account, payer }: { account: string; payer?: string | null }) {
  const [state, setState] = useState<{ for: string; result?: FreeCheckResult; failed?: boolean }>({ for: "" });
  const key = `${account}|${payer ?? ""}`;

  useEffect(() => {
    let alive = true;
    const timer = setTimeout(async () => {
      try {
        const query = new URLSearchParams({ account, ...(payer ? { payer } : {}) });
        const response = await fetch(`/api/check?${query}`);
        if (!response.ok) throw new Error(String(response.status));
        const result = (await response.json()) as FreeCheckResult;
        if (alive) setState({ for: key, result });
      } catch {
        if (alive) setState({ for: key, failed: true });
      }
    }, 700);
    return () => { alive = false; clearTimeout(timer); };
  }, [account, payer, key]);

  if (state.for !== key) return <p className="text-[14px] muted" data-testid="free-check" aria-live="polite">Running the free check of {account}&hellip;</p>;
  if (state.failed || !state.result) return <p className="text-[14px] muted" data-testid="free-check">The free check could not reach the network just now. You can still buy the paid check.</p>;
  const r = state.result;
  const blocklist = r.signals.find((s) => s.id === "reported" && s.status === "found");
  return (
    <div className="inset space-y-2" data-testid="free-check" role="status">
      <p className="flex flex-wrap items-center gap-2">
        <VerdictBadge verdict={r.verdict} />
        <span className="text-[14px] muted">Free, before you pay: Lien&rsquo;s extended check, built on Sentinel&rsquo;s rules</span>
      </p>
      <p className="text-[15px] leading-snug">
        Score {r.score} of 100. Sentinel&rsquo;s rules alone, on keys and code: {r.sentinel_rules.score} ({r.sentinel_rules.verdict}).
      </p>
      {blocklist?.reports?.length ? (
        <div className="space-y-1 text-[15px] leading-snug" data-testid="free-check-reports">
          {blocklist.reports.map((report) => (
            <p key={report.id}>
              <span className="font-medium">Reported</span> by <span className="[overflow-wrap:anywhere]">{report.reporter}</span> on {report.reported_at.slice(0, 10)}: {report.reason}{" "}
              <a className="link" href={report.evidence_url} target="_blank" rel="noreferrer">See the evidence</a>
            </p>
          ))}
        </div>
      ) : null}
      <ul className="space-y-1 text-[14px]" aria-label="Signals">
        {r.signals.map((s) => {
          const href = sourceHref(s.source);
          return (
            <li key={s.id} className="leading-snug">
              <span className="font-medium">{LABEL[s.id]}</span>
              <span className="muted"> &middot; {STATUS[s.status]}{s.points ? `, +${s.points}` : ""}</span>
              {s.id === "reported" && s.status === "found" ? null : <span className="text-[var(--ink-2)]"> &middot; {s.summary}</span>}
              {href ? <> <a className="link" href={href} target="_blank" rel="noreferrer">source</a></> : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
