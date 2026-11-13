"use client";

import { useEffect, useState, type ReactNode } from "react";
import { AccountLink, Panel, Term } from "@/components/ui";
import { attestationUrl, deployment, txUrl } from "@/lib/config";
import { dateTime, money, shortHash } from "@/lib/format";
import { GLOSSARY } from "@/lib/glossary";
import { checkBuild, checkCode, checkNoKeys, checkSolvent, latestAttestationQuiet, type Attestation, type Check } from "@/lib/near/proof";
import type { Business } from "@/lib/near/types";

type State = "checking" | "ok" | "fail" | "unknown";
type Row = { state: State; detail: string };

/** Each proof in plain words first: what it means for someone lending money. */
const CLAIMS: Record<string, { label: string; plain: string }> = {
  keys: { label: "Nobody can withdraw its money", plain: "The account has no keys at all, so no person, not even its owner, can move money out." },
  code: { label: "It runs the standard Lien contract", plain: "Its rules are the same public contract every Lien business runs." },
  build: { label: "Its program is public", plain: "Anyone can download the exact program it runs and check it is the one promised." },
  ledger: { label: "Its books add up", plain: "Every dollar it holds is accounted for: owed to lenders, to the owner, kept for running costs, or held for refunds and bids." },
  enclave: { label: "Its work runs on a sealed computer", plain: "Each check runs on a secure computer that proves which program it ran." },
};

function StateDot({ state }: { state: State }) {
  if (state === "checking") return <span className="spinner mt-[3px]" aria-hidden />;
  const ok = state === "ok";
  const tone = ok ? "var(--ok)" : state === "fail" ? "var(--danger)" : "var(--muted)";
  return (
    <span aria-hidden className="mt-[1px] grid h-[18px] w-[18px] place-items-center rounded-full" style={{ background: `color-mix(in oklab, ${tone} 18%, transparent)`, color: tone }}>
      <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{ok ? <path d="M2.5 6.2l2.3 2.3 4.7-5" /> : <path d="M6 3v3.6M6 9h.01" />}</svg>
    </span>
  );
}

function Result({ claim, state, detail, waiting = false }: { claim: keyof typeof CLAIMS; state: State; detail: ReactNode; waiting?: boolean }) {
  const word = state === "checking" ? "Checking" : state === "ok" ? "Proven" : state === "fail" ? "Failed" : waiting ? "After the first check" : "Could not check";
  const color = state === "ok" ? "var(--ok)" : state === "fail" ? "var(--danger)" : "var(--muted)";
  return (
    <li className="grid grid-cols-[auto_1fr_auto] items-start gap-x-3 py-3" data-testid="proof-row" data-state={state}>
      <StateDot state={state} />
      <div className="min-w-0">
        <p className="text-[15px] font-medium">{CLAIMS[claim]!.label}</p>
        <p className="text-[14px] text-[var(--ink-2)]">{CLAIMS[claim]!.plain}</p>
        <p className="mt-1 text-[13px] break-words muted">{detail}</p>
      </div>
      <p className="text-[14px] font-medium" style={{ color }}>{word}</p>
    </li>
  );
}

const toRow = (promise: Promise<Check>, set: (row: Row) => void, fallback: string) => {
  set({ state: "checking", detail: fallback });
  promise
    .then((c) => set({ state: c.ok ? "ok" : "fail", detail: c.detail }))
    .catch(() => set({ state: "unknown", detail: "That source could not be reached just now." }));
};

/** Re-runs the checks only when the business or its build changes, not on every poll. */
export function ProofPanel({ business: b, listed }: { business: Business; listed: boolean | undefined }) {
  const [rows, setRows] = useState<Record<string, Row>>({});
  const [attestation, setAttestation] = useState<Attestation | null | undefined>(undefined);
  // Bumped by "Check again", which reruns every check against its source.
  const [round, setRound] = useState(0);
  const { id } = b;
  const { url, hash } = b.service.wasm;
  const jobsDone = b.stats.jobs_done;
  const ledgerKey = JSON.stringify(b.ledger);

  useEffect(() => {
    let alive = true;
    const set = (key: string) => (row: Row) => { if (alive) setRows((all) => ({ ...all, [key]: row })); };
    toRow(checkNoKeys(id), set("keys"), "Reading the account's access keys");
    toRow(checkCode(id), set("code"), "Comparing its code with the published one");
    toRow(checkBuild(url, hash), set("build"), "Downloading the program and fingerprinting it here");
    return () => { alive = false; };
  }, [id, url, hash, round]);

  useEffect(() => {
    let alive = true;
    const set = (row: Row) => { if (alive) setRows((all) => ({ ...all, ledger: row })); };
    const parsed = JSON.parse(ledgerKey) as Business["ledger"];
    toRow(
      checkSolvent({ id, ledger: parsed } as Business).then((c) => ({ ok: c.ok, detail: c.ok ? `Holds ${money(c.held)}, and every dollar of it is accounted for` : `Holds ${money(c.held)}, but its books account for ${money(c.owed)}` })),
      set,
      "Comparing what it holds with what it owes",
    );
    return () => { alive = false; };
  }, [id, ledgerKey, round]);

  useEffect(() => {
    let alive = true;
    if (jobsDone === 0) return;
    latestAttestationQuiet(id).then((a) => { if (alive) setAttestation(a); }).catch(() => { if (alive) setAttestation(null); });
    return () => { alive = false; };
  }, [id, jobsDone, round]);

  const unreached = Object.values(rows).some((r) => r.state === "unknown") || (jobsDone > 0 && attestation === null);

  const order = ["keys", "code", "build", "ledger"] as const;
  return (
    <Panel title="Why you can trust this business" aside="Checked live, in your browser" id="proof">
      {listed === false ? (
        <p role="alert" className="callout mb-3">This account is not in the Lien registry. Its figures may not mean what they say.</p>
      ) : null}
      <ul className="divide-y divide-[var(--line)]" aria-live="polite">
        {order.map((key) => (rows[key] ? <Result key={key} claim={key} state={rows[key].state} detail={rows[key].detail} /> : null))}
        <AttestationRow attestation={jobsDone === 0 ? null : attestation} pinned={hash} jobsDone={jobsDone} />
      </ul>
      {unreached ? (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-[12px] bg-[var(--surface-2)] px-4 py-3 text-[14px]">
          <span className="text-[var(--ink-2)]">A public source did not answer in time. Nothing failed; it simply was not checked.</span>
          <button type="button" className="btn btn-secondary btn-sm" data-testid="proof-retry" onClick={() => { setAttestation(undefined); setRound((r) => r + 1); }}>Check again</button>
        </div>
      ) : null}
      <details className="mt-3 text-[14px]">
        <summary className="cursor-pointer py-2 text-[var(--ink-2)] hover:text-[var(--ink)]">Show the technical proof</summary>
        <dl className="dl mt-2 rounded-[12px] bg-[var(--surface-2)] p-4 text-[14px]">
          <dt>Program fingerprint (pinned build)</dt><dd><a className="link" href={url} target="_blank" rel="noreferrer"><code>{shortHash(hash)}</code></a></dd>
          <dt>Contract code</dt><dd><code>{shortHash(deployment.agentCode)}</code></dd>
          <dt>Secure computing</dt><dd><AccountLink id={b.outlayer} /></dd>
          {b.source_url ? (<><dt>Source</dt><dd><a className="link" href={b.source_url} target="_blank" rel="noreferrer">Read the code</a></dd></>) : null}
        </dl>
      </details>
    </Panel>
  );
}

function AttestationRow({ attestation, pinned, jobsDone }: { attestation: Attestation | null | undefined; pinned: string; jobsDone: number }) {
  if (attestation === undefined) return <Result claim="enclave" state="checking" detail="Finding the latest proof from the secure computer" />;
  if (attestation === null) {
    return <Result claim="enclave" state="unknown" waiting={jobsDone === 0} detail={jobsDone === 0 ? "No checks have run yet. The proof appears with the first one." : "Proof not available for this business's recent jobs right now. Use Check again to retry."} />;
  }
  const matches = attestation.executed_wasm_sha256 === pinned;
  return (
    <Result
      claim="enclave"
      state={matches ? "ok" : "fail"}
      detail={(
        <>
          {matches ? "The latest Intel TDX quote names the pinned program. " : "The latest quote names a different program. "}
          <Term tip={GLOSSARY.sealedComputer}>What is this?</Term>{" · "}
          <a className="link" href={txUrl(attestation.transaction_hash)} target="_blank" rel="noreferrer">See the transaction</a>
          {/* The quote itself, as this page just loaded it, so the evidence never depends on a link working later. */}
          <details className="mt-2" data-testid="quote">
            <summary className="cursor-pointer text-[var(--ink-2)] hover:text-[var(--ink)]">Show the quote</summary>
            <dl className="dl mt-2 rounded-[10px] bg-[var(--surface-2)] p-3 text-[13px]">
              <dt>Program that ran</dt><dd><code>{shortHash(attestation.executed_wasm_sha256)}</code></dd>
              <dt>Request</dt><dd>#{attestation.request_id}</dd>
              <dt>When</dt><dd>{dateTime(Number(attestation.timestamp))}</dd>
              <dt>Worker measurement</dt><dd><code>{shortHash(attestation.worker_measurement)}</code></dd>
              <dt>Intel TDX quote</dt><dd><code title={attestation.tdx_quote}>{attestation.tdx_quote.slice(0, 24)}…</code></dd>
            </dl>
            <a className="link mt-2 inline-block" href={attestationUrl(attestation.transaction_hash)} target="_blank" rel="noreferrer">Open it on OutLayer</a>
          </details>
        </>
      )}
    />
  );
}
