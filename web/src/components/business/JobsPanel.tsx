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
    <Panel title="Work sold" aside={`${b.stats.jobs_done} delivered, ${b.stats.jobs_refunded} refunded`}>
      {!live.loaded ? <div className="space-y-2"><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /></div> : jobs.length === 0 ? (
        <p className="rounded-[12px] bg-[var(--surface-2)] p-5 text-[15px] text-[var(--ink-2)]">No work sold yet. The first customer can buy a check from the actions on this page.</p>
      ) : (
        <div className="-mx-[18px] sm:-mx-[22px] overflow-x-auto">
          <table className="table min-w-[620px]">
            <thead>
              <tr><th scope="col">Asked</th><th scope="col">Customer</th><th scope="col">Result</th><th scope="col" className="r">Paid</th><th scope="col" className="r">When</th></tr>
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
      )}
    </Panel>
  );
}

function JobRow({ job, result, open, onToggle }: { job: Job; result: string; open: boolean; onToggle: () => void }) {
  return (
    <>
      <tr data-row="link" onClick={onToggle} data-testid={`job-${job.id}`}>
        <td className="max-w-[240px]">
          <button type="button" className="block max-w-full truncate text-left hover:underline" aria-expanded={open} onClick={(e) => { e.stopPropagation(); onToggle(); }}>{job.input || "(empty)"}</button>
        </td>
        <td title={job.payer} className="whitespace-nowrap">{shortAccount(job.payer, 22)}</td>
        <td className="whitespace-nowrap first-letter:uppercase">{result}</td>
        <td className="r whitespace-nowrap">{money(job.paid)}</td>
        <td className="r whitespace-nowrap">{dateTime(job.created_at)}</td>
      </tr>
      {open ? (
        <tr><td colSpan={5} className="bg-[var(--surface-2)]">
          {job.status === "Done" ? <ReportCard raw={job.report} /> : <p>{job.status === "Pending" ? "OutLayer is running this job now." : "This job could not be completed, so the customer was refunded in full."}</p>}
          <p className="mt-2 text-[13px] muted">Ran build <code>{job.wasm_hash.slice(0, 16)}…</code></p>
        </td></tr>
      ) : null}
    </>
  );
}
