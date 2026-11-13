"use client";

import { useState } from "react";
import { Panel, Skeleton } from "@/components/ui";
import { useLive } from "@/hooks/useLive";
import { dateTime, money, shortAccount } from "@/lib/format";
import { getJobs } from "@/lib/near/rpc";
import type { Business, Job } from "@/lib/near/types";
import { parseReport } from "@/lib/report";
import { ReportCard } from "./ReportCard";

const STATUS: Record<Job["status"], string> = { Pending: "Running", Done: "Delivered", Refunded: "Refunded" };

export function JobsPanel({ business: b }: { business: Business }) {
  const live = useLive(() => getJobs(b.id, 12), `jobs:${b.id}:${b.next_job_id}:${b.pending_jobs}`, 10_000);
  const [open, setOpen] = useState<number | null>(null);
  const jobs = live.data ?? [];
  return (
    <Panel title="Checks it has sold" aside={`${b.stats.jobs_done} delivered, ${b.stats.jobs_refunded} refunded`}>
      {!live.loaded ? <div className="space-y-2"><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /></div> : jobs.length === 0 ? (
        <p className="rounded-[12px] bg-[var(--surface-2)] p-5 text-[15px] text-[var(--ink-2)]">Nothing sold yet. Be its first customer: buy a safety check from the actions on this page.</p>
      ) : (
        <>
        <Concentration jobs={jobs} uniquePayers={b.stats.unique_payers} />
        <div className="w-full overflow-hidden">
          <table className="table w-full table-fixed">
            <thead>
              <tr><th scope="col">Checked</th><th scope="col" className="hidden w-[24%] 2xl:table-cell">Customer</th><th scope="col" className="w-[124px]">Result</th><th scope="col" className="r w-[80px]">Paid</th><th scope="col" className="r hidden w-[150px] sm:table-cell">When (UTC)</th></tr>
            </thead>
            <tbody>
              {group(jobs).map(({ job, count }) => {
                const report = parseReport(job.report);
                return (
                  <JobRow key={job.id} job={job} count={count} result={job.status === "Done" && report ? `${report.level} risk` : STATUS[job.status]} open={open === job.id} onToggle={() => setOpen(open === job.id ? null : job.id)} />
                );
              })}
            </tbody>
          </table>
        </div>
        </>
      )}
    </Panel>
  );
}

/** The Lien team's own accounts: their purchases are tests and the heartbeat, not customers. */
export const isTeamAccount = (account: string) => /^lien-f\d+-\d+\.testnet$/.test(account) || account === "lien-13569.testnet";

/** Back-to-back sales of the same check, by the same buyer, with the same result, read as one row "×4". */
function group(jobs: Job[]): Array<{ job: Job; count: number }> {
  const out: Array<{ job: Job; count: number }> = [];
  for (const job of jobs) {
    const last = out[out.length - 1];
    if (last && last.job.input.trim() === job.input.trim() && last.job.payer === job.payer && last.job.status === job.status) last.count++;
    else out.push({ job, count: 1 });
  }
  return out;
}

function JobRow({ job, count, result, open, onToggle }: { job: Job; count: number; result: string; open: boolean; onToggle: () => void }) {
  const team = isTeamAccount(job.payer);
  return (
    <>
      <tr data-row="link" onClick={onToggle} data-testid={`job-${job.id}`}>
        <td className="min-w-0">
          <span className="flex min-w-0 items-center gap-2">
            <button type="button" className="block min-w-0 truncate text-left hover:underline" title={job.input} aria-expanded={open} onClick={(e) => { e.stopPropagation(); onToggle(); }}>{job.input || "(empty)"}</button>
            {count > 1 ? <span className="shrink-0 text-[13px] muted">×{count}</span> : null}
            {team ? <span className="chip shrink-0 text-[12px]" title="Bought by the Lien team's own test account, not a customer">Lien team</span> : null}
          </span>
        </td>
        <td title={job.payer} className="hidden truncate 2xl:table-cell">{shortAccount(job.payer, 22)}</td>
        <td className="truncate first-letter:uppercase">{result}</td>
        <td className="r whitespace-nowrap">{money(job.paid)}</td>
        <td className="r hidden whitespace-nowrap sm:table-cell">{dateTime(job.created_at).replace(" UTC", "")}</td>
      </tr>
      {open ? (
        <tr><td colSpan={5} className="bg-[var(--surface-2)]">
          {job.status === "Done" ? <ReportCard raw={job.report} /> : <p>{job.status === "Pending" ? "The secure computer is running this check now." : "This check could not finish, so the customer was refunded in full."}</p>}
          <p className="mt-2 text-[13px] muted">Bought by {shortAccount(job.payer, 32)} · {dateTime(job.created_at)} · program <code>{job.wasm_hash.slice(0, 12)}…</code></p>
        </td></tr>
      ) : null}
    </>
  );
}

/**
 * How much of the recent work one customer bought. A business can buy its own work to look
 * busy; this says so plainly instead of leaving lenders to spot it in the table.
 */
function Concentration({ jobs, uniquePayers }: { jobs: Job[]; uniquePayers: number }) {
  const counts = new Map<string, number>();
  for (const job of jobs) counts.set(job.payer, (counts.get(job.payer) ?? 0) + 1);
  const [top, n] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0] ?? ["", 0];
  if (!n) return null;
  const share = Math.round((n / jobs.length) * 100);
  const concentrated = share >= 50 && jobs.length >= 3;
  const teamSales = jobs.filter((j) => isTeamAccount(j.payer)).length;
  const outsiders = [...counts.keys()].filter((p) => !isTeamAccount(p)).length;
  return (
    <p data-testid="concentration" className={`mb-4 rounded-[12px] p-4 text-[15px] ${concentrated ? "bg-[var(--warn-bg,#2a2114)]" : "bg-[var(--surface-2)]"}`}>
      {uniquePayers} {uniquePayers === 1 ? "customer has" : "different customers have"} bought from it in all.
      {teamSales ? ` Of the last ${jobs.length} sales, ${teamSales} ${teamSales === 1 ? "was" : "were"} the Lien team's own test ${teamSales === 1 ? "purchase" : "purchases"} (tagged), and ${outsiders} ${outsiders === 1 ? "other buyer" : "other buyers"} bought the rest.` : ""}
      {" "}The biggest buyer, <span title={top}>{shortAccount(top, 22)}</span>, bought {share}% of the last {jobs.length} {jobs.length === 1 ? "sale" : "sales"}.
      {concentrated ? (isTeamAccount(top) ? " That is the Lien team testing it, so these sales show it works, not that customers want it." : " So treat its sales as a claim, not proof that people want it: that one buyer could be its own owner.") : ""}
    </p>
  );
}
