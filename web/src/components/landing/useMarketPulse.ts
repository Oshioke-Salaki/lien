"use client";

import { useLive } from "@/hooks/useLive";
import { getJobs, listBusinesses } from "@/lib/near/rpc";
import type { Job } from "@/lib/near/types";

export type Pulse = { businesses: number; jobs: number; repaid: bigint; latest: Job | null; latestBusiness: string | null };

/** The landing page's figures come from the chain, with nothing typed in. */
async function read(): Promise<Pulse> {
  const all = await listBusinesses();
  const busiest = [...all].sort((a, b) => b.stats.jobs_done - a.stats.jobs_done)[0];
  const jobs = busiest ? await getJobs(busiest.id, 8) : [];
  const latest = jobs.find((j) => j.status === "Done") ?? null;
  return {
    businesses: all.length,
    jobs: all.reduce((sum, b) => sum + b.stats.jobs_done, 0),
    repaid: all.reduce((sum, b) => sum + BigInt(b.current_loan?.repaid ?? 0), 0n),
    latest,
    latestBusiness: busiest?.name ?? null,
  };
}

export function useMarketPulse() {
  return useLive(read, "pulse", 20_000);
}
