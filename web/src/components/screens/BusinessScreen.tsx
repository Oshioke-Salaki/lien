"use client";

import Link from "next/link";
import { ActionRail } from "@/components/business/ActionRail";
import { DebtPanel, TermsPanel, WaterfallPanel } from "@/components/business/DebtPanel";
import { HistoryPanel } from "@/components/business/HistoryPanel";
import { JobsPanel } from "@/components/business/JobsPanel";
import { ProofPanel } from "@/components/business/ProofPanel";
import { AccountLink, ErrorState, Skeleton, StandingLabel } from "@/components/ui";
import { useChainNow, useLive } from "@/hooks/useLive";
import { getBusiness, listBusinessIds } from "@/lib/near/rpc";
import { standing } from "@/lib/status";

export function BusinessScreen({ id }: { id: string }) {
  const live = useLive(() => getBusiness(id), `business:${id}`, 4_000);
  const registry = useLive(listBusinessIds, "registry-ids", 0);
  const now = useChainNow(live.data?.now);

  if (live.error && !live.data) {
    const missing = /UNKNOWN_ACCOUNT|CodeDoesNotExist|does not exist|MethodNotFound/i.test(live.error.message);
    return (
      <ErrorState
        message={missing ? `There is no Lien business at ${id}.` : "The network could not be reached. This page will keep trying."}
        onRetry={missing ? undefined : () => void live.refresh()}
      />
    );
  }

  if (!live.data) {
    return (
      <div className="space-y-4" aria-busy="true">
        <h1 className="text-[28px] leading-tight font-medium tracking-[-0.01em]">{id.split(".")[0]}</h1>
        <p className="text-[15px] muted">Reading this business from the chain…</p>
        <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(0,1fr)_372px]">
          <Skeleton className="h-64" />
          <Skeleton className="h-64" />
        </div>
      </div>
    );
  }

  const b = { ...live.data, now };
  const listed = registry.data?.includes(id);
  const foreclosed = b.current_loan?.status === "Foreclosed";

  return (
    <div className="space-y-5">
      <div>
        <p className="text-[14px]"><Link className="link muted" href="/market">Market</Link></p>
        <div className="mt-1 flex flex-wrap items-baseline gap-x-5 gap-y-1">
          <h1 className="text-[28px] leading-tight font-medium tracking-[-0.01em]">{b.name}</h1>
          <StandingLabel standing={standing(b)} />
        </div>
        {b.description ? <p className="mt-1 max-w-[70ch] text-[16px]">{b.description}</p> : null}
        <p className="mt-1 text-[14px] muted">
          <AccountLink id={b.id} max={44} /> · operated by <AccountLink id={b.operator} />
        </p>
      </div>

      {foreclosed ? <ForeclosureNotice key={b.current_loan!.id} /> : null}

      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-4 lg:grid-cols-[minmax(0,1fr)_372px]">
        {/* On a phone the actions sit right after the debt, not below every table. */}
        <div className="contents lg:block lg:space-y-4">
          <div className="order-1"><DebtPanel business={b} now={now} /></div>
          <div className="order-3 space-y-4">
            <WaterfallPanel business={b} now={now} />
            <ProofPanel business={b} listed={registry.loaded ? listed : undefined} />
            <JobsPanel business={b} />
            <TermsPanel business={b} />
            <HistoryPanel business={b} />
          </div>
        </div>
        <div className="order-2 lg:order-none"><ActionRail business={b} now={now} refresh={live.refresh} /></div>
      </div>
    </div>
  );
}

function ForeclosureNotice() {
  return (
    <div className="flex items-center justify-between gap-4 overflow-hidden bg-[var(--accent)] px-5 py-4" data-testid="foreclosure-notice">
      <p className="text-[17px] font-medium">Notice of foreclosure. Same address, same service, new beneficiaries.</p>
      <span className="stamp-in hidden shrink-0 border-[3px] border-black px-3 py-1 text-[15px] font-semibold tracking-[0.02em] sm:block">Foreclosed</span>
    </div>
  );
}
