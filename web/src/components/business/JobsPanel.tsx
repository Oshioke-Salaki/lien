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
        <div className="-mx-[18px] sm:-mx-[22px]">
          <table className="table table-fixed">
            <thead>
              <tr><th scope="col">Checked</th><th scope="col" className="hidden w-[28%] xl:table-cell">Customer</th><th scope="col" className="w-[124px]">Result</th><th scope="col" className="r w-[80px]">Paid</th><th scope="col" className="r hidden w-[104px] sm:table-cell">When</th></tr>
            </thead>
            <tbody>
              {jobs.map((job) => {
                const report = parseReport(job.report);
                return (
                  <JobRow key={job.id} job={job} result={job.status === "Done" && report ? `${report.level} risk` : STATUS[job.status]} open={open === job.id} onToggle={() => setOpen(open === job.id ? null : job.id)} />
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

function JobRow({ job, result, open, onToggle }: { job: Job; result: string; open: boolean; onToggle: () => void }) {
  return (
    <>
      <tr data-row="link" onClick={onToggle} data-testid={`job-${job.id}`}>
        <td className="min-w-0">
          <button type="button" className="block max-w-full truncate text-left hover:underline" title={job.input} aria-expanded={open} onClick={(e) => { e.stopPropagation(); onToggle(); }}>{job.input || "(empty)"}</button>
        </td>
        <td title={job.payer} className="hidden truncate xl:table-cell">{shortAccount(job.payer, 22)}</td>
        <td className="truncate first-letter:uppercase">{result}</td>
        <td className="r whitespace-nowrap">{money(job.paid)}</td>
        <td className="r hidden whitespace-nowrap sm:table-cell">{dateTime(job.created_at)}</td>
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
  return (
    <p data-testid="concentration" className={`mb-4 rounded-[12px] p-4 text-[15px] ${concentrated ? "bg-[var(--warn-bg,#2a2114)]" : "bg-[var(--surface-2)]"}`}>
      {uniquePayers} {uniquePayers === 1 ? "customer has" : "different customers have"} bought from it. The biggest, <span title={top}>{shortAccount(top, 22)}</span>, bought {share}% of the last {jobs.length} {jobs.length === 1 ? "sale" : "sales"}.
      {concentrated ? " So treat its sales as a claim, not proof that people want it: that one buyer could be its own owner." : ""}
    </p>
  );
}
