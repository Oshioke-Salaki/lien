"use client";

import Link from "next/link";
import { ProofPanel } from "@/components/business/ProofPanel";
import { PageHead, Panel, Skeleton } from "@/components/ui";
import { useLive } from "@/hooks/useLive";
import { deployment } from "@/lib/config";
import { CLAIMS } from "@/lib/claims";
import { getBusiness } from "@/lib/near/rpc";

const SENTINEL = `sentinel.${deployment.registry}`;

/**
 * Everything Lien promises, on one page: the checks run live in this browser against a real
 * business, and every promise links to the code that enforces it, the test that proves it and
 * a testnet transaction where it happened.
 */
export function ProofScreen() {
  const sentinel = useLive(() => getBusiness(SENTINEL), "proof:sentinel", 0);
  return (
    <div className="space-y-8">
      <PageHead
        title="Proof"
        lead="Every promise Lien makes, with the check your browser runs right now, the code and test behind it, and a real transaction where it happened. Nothing here asks you to trust us."
      />

      <section aria-labelledby="live-title" className="space-y-3">
        <h2 id="live-title" className="text-[22px] font-medium tracking-[-0.015em]">Checked live, on a real business</h2>
        <p className="max-w-[70ch] text-[15px] text-[var(--ink-2)]">
          These run in your browser against <Link className="link" href={`/b/${SENTINEL}`}>Sentinel</Link>, reading the public network directly. Every business page runs the same checks.
        </p>
        {sentinel.data ? <ProofPanel business={sentinel.data} listed={true} /> : <Skeleton className="h-[360px] w-full" />}
      </section>

      <section aria-labelledby="claims-title" className="space-y-3">
        <h2 id="claims-title" className="text-[22px] font-medium tracking-[-0.015em]">Every promise, with its evidence</h2>
        <ol className="space-y-3" data-testid="claims">
          {CLAIMS.map((claim) => (
            <li key={claim.promise}>
              <Panel>
                <div className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
                  <div>
                    <p className="text-[17px] font-medium">{claim.promise}</p>
                    <p className="mt-1 text-[15px] text-[var(--ink-2)]">{claim.plain}</p>
                    {claim.live ? <p className="mt-2 text-[13px] muted">Checked live in the panel above.</p> : null}
                  </div>
                  <div className="space-y-3 text-[14px]">
                    {claim.tests.length ? (
                      <div>
                        <p className="muted">Proved by</p>
                        <ul className="mt-1 space-y-1">
                          {claim.tests.map((t) => <li key={t.name} className="break-words"><a className="link" href={t.href} target="_blank" rel="noreferrer"><code>{t.name}</code></a></li>)}
                        </ul>
                      </div>
                    ) : null}
                    <div>
                      <p className="muted">Seen on the test network</p>
                      <ul className="mt-1 space-y-1">
                        {claim.evidence.map((e) => <li key={e.href}><a className="link" href={e.href} target="_blank" rel="noreferrer">{e.label}</a></li>)}
                      </ul>
                    </div>
                  </div>
                </div>
              </Panel>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
