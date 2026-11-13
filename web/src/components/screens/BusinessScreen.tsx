"use client";

import Link from "next/link";
import { ActionRail } from "@/components/business/ActionRail";
import { DebtPanel, TermsPanel, WaterfallPanel } from "@/components/business/DebtPanel";
import { HistoryPanel } from "@/components/business/HistoryPanel";
import { IntentsPanel } from "@/components/business/IntentsPanel";
import { JobsPanel } from "@/components/business/JobsPanel";
import { ProofPanel } from "@/components/business/ProofPanel";
import { AccountLink, ErrorState, Skeleton, StandingLabel, Term } from "@/components/ui";
import { useChainNow, useLive } from "@/hooks/useLive";
import { GLOSSARY } from "@/lib/glossary";
import { getBusiness, listBusinessIds } from "@/lib/near/rpc";
import { describe, sampleNote } from "@/lib/demo";
import type { Business } from "@/lib/near/types";
import { standing } from "@/lib/status";

function Crumb({ name }: { name: string }) {
  return (
    <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-[14px] muted">
      <Link className="transition-colors hover:text-[var(--ink)]" href="/market">Market</Link>
      <span aria-hidden>/</span>
      <span className="truncate text-[var(--ink-2)]">{name}</span>
    </nav>
  );
}

export function BusinessScreen({ id, initial }: { id: string; initial?: Business }) {
  const live = useLive(() => getBusiness(id), `business:${id}`, 4_000, initial);
  const registry = useLive(listBusinessIds, "registry-ids", 0);
  const now = useChainNow(live.data?.now);

  if (live.error && !live.data) {
    const missing = /UNKNOWN_ACCOUNT|CodeDoesNotExist|does not exist|MethodNotFound/i.test(live.error.message);
    return (
      <div className="space-y-6">
        <Crumb name={id.split(".")[0]!} />
        <ErrorState
          message={missing ? `There is no Lien business at ${id}.` : "The network could not be reached. This page will keep trying."}
          onRetry={missing ? undefined : () => void live.refresh()}
        />
        {missing ? <Link className="btn btn-secondary" href="/market">Back to the market</Link> : null}
      </div>
    );
  }

  if (!live.data) {
    return (
      <div className="space-y-6" aria-busy="true">
        <Crumb name={id.split(".")[0]!} />
        <div className="space-y-3">
          <h1 className="text-[clamp(30px,3.4vw,40px)] leading-[1.05] font-medium tracking-[-0.025em]">{id.split(".")[0]}</h1>
          <p className="text-[15px] muted">Reading this business from the chain…</p>
        </div>
        <div className="grid grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
          <div className="space-y-5"><Skeleton className="h-[260px]" /><Skeleton className="h-[140px]" /><Skeleton className="h-[320px]" /></div>
          <div className="space-y-5"><Skeleton className="h-[220px]" /><Skeleton className="h-[180px]" /></div>
        </div>
      </div>
    );
  }

  const b = { ...live.data, now };
  const listed = registry.data?.includes(id);
  const foreclosed = b.current_loan?.status === "Foreclosed";

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <Crumb name={b.name} />
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <h1 className="text-[clamp(30px,3.4vw,40px)] leading-[1.05] font-medium tracking-[-0.025em]">{b.name}</h1>
          <StandingLabel standing={standing(b)} />
        </div>
        {b.description ? <p className="max-w-[64ch] text-[17px] leading-snug text-[var(--ink-2)]">{describe(b.id, b.description)}</p> : null}
        {sampleNote(b) ? <p className="inline-flex items-center gap-2 rounded-full bg-[var(--surface)] px-3 py-1 text-[13px] text-[var(--ink-2)]" data-testid="sample-note"><span aria-hidden className="h-[6px] w-[6px] rounded-full bg-[var(--accent)]" />{sampleNote(b)}</p> : null}
        <p className="flex flex-wrap gap-x-2 gap-y-1 text-[14px] muted">
          <span>An AI business at <AccountLink id={b.id} max={44} /></span>
          <span aria-hidden>·</span>
          <span><Term tip={GLOSSARY.owner}>Owned by</Term> <AccountLink id={b.operator} /></span>
        </p>
      </div>

      {foreclosed ? <ForeclosureNotice key={b.current_loan!.id} /> : null}

      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
        {/* On a phone the actions sit right after the debt, not below every table. */}
        <div className="contents lg:block lg:space-y-5">
          <div className="order-1"><DebtPanel business={b} now={now} /></div>
          <div className="order-3 space-y-5">
            <WaterfallPanel business={b} now={now} />
            <ProofPanel business={b} listed={registry.loaded ? listed : undefined} />
            <JobsPanel business={b} />
            <TermsPanel business={b} />
            <HistoryPanel business={b} />
            {/* For people paying from other blockchains: folded away so it never confronts a newcomer. */}
            <details className="group rounded-[16px] bg-[var(--surface)]" data-testid="intents-disclosure">
              <summary className="flex min-h-[56px] cursor-pointer list-none items-center justify-between gap-3 px-5 text-[16px] font-medium [&::-webkit-details-marker]:hidden">
                Pay from another blockchain
                <span aria-hidden className="text-[var(--muted)] transition-transform group-open:rotate-180">▾</span>
              </summary>
              <div className="px-1 pb-1"><IntentsPanel business={b} refresh={live.refresh} /></div>
            </details>
          </div>
        </div>
        <div className="order-2 lg:order-none"><ActionRail business={b} now={now} refresh={live.refresh} /></div>
      </div>
    </div>
  );
}

function ForeclosureNotice() {
  return (
    <div className="flex items-center justify-between gap-4 overflow-hidden rounded-[16px] bg-[rgb(255_122_110_/_0.1)] px-5 py-4 shadow-[inset_0_0_0_1px_rgb(255_122_110_/_0.35)]" data-testid="foreclosure-notice" role="status">
      <div>
        <p className="text-[17px] font-medium">Notice: taken over for its lenders</p>
        <p className="mt-1 text-[15px] text-[var(--ink-2)]">It missed its payments, so it now works for its lenders. Same address and same service, but every sale pays lenders the owner&rsquo;s share too, until someone buys the business at auction.</p>
        <p className="mt-2 text-[14px] text-[var(--ink-2)]">At the takeover, the owner&rsquo;s unpaid share and any running money above about a week&rsquo;s costs went straight to lenders, which is why &ldquo;paid back&rdquo; jumped.</p>
      </div>
      <span className="stamp-in hidden shrink-0 rounded-[6px] border-2 border-[var(--danger)] px-3 py-1 text-[14px] font-semibold text-[var(--danger)] sm:block">Taken over</span>
    </div>
  );
}
