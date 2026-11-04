"use client";

import { useEffect, useState } from "react";
import { AccountLink, Panel } from "@/components/ui";
import { attestationUrl, deployment, txUrl } from "@/lib/config";
import { money, shortHash } from "@/lib/format";
import { checkBuild, checkCode, checkNoKeys, checkSolvent, latestAttestation, type Attestation, type Check } from "@/lib/near/proof";
import type { Business } from "@/lib/near/types";

type Row = { label: string; state: "checking" | "ok" | "fail" | "unknown"; detail: string };

function Result({ row }: { row: Row }) {
  const word = row.state === "checking" ? "Checking" : row.state === "ok" ? "Verified" : row.state === "fail" ? "Failed" : "Could not check";
  const color = row.state === "ok" ? "var(--ok)" : row.state === "fail" ? "var(--danger)" : "var(--muted)";
  return (
    <li className="grid grid-cols-[1fr_auto] gap-x-4 py-[10px]" data-testid="proof-row" data-state={row.state}>
      <div className="min-w-0">
        <p className="text-[15px]">{row.label}</p>
        <p className="text-[14px] break-words muted">{row.detail}</p>
      </div>
      <p className="text-[14px] font-medium" style={{ color }}>{word}</p>
    </li>
  );
}

const toRow = (label: string, promise: Promise<Check>, set: (row: Row) => void, fallback: string) => {
  set({ label, state: "checking", detail: fallback });
  promise
    .then((c) => set({ label, state: c.ok ? "ok" : "fail", detail: c.detail }))
    .catch(() => set({ label, state: "unknown", detail: "That source could not be reached just now." }));
};

/** Re-runs the checks only when the business or its build changes, not on every poll. */
export function ProofPanel({ business: b, listed }: { business: Business; listed: boolean | undefined }) {
  const [rows, setRows] = useState<Record<string, Row>>({});
  const [attestation, setAttestation] = useState<Attestation | null | undefined>(undefined);
  const { id } = b;
  const { url, hash } = b.service.wasm;
  const jobsDone = b.stats.jobs_done;
  const ledgerKey = JSON.stringify(b.ledger);

  useEffect(() => {
    let alive = true;
    const set = (key: string) => (row: Row) => { if (alive) setRows((all) => ({ ...all, [key]: row })); };
    toRow("Nobody holds its keys", checkNoKeys(id), set("keys"), "Reading the account's access keys");
    toRow("It runs the audited contract", checkCode(id), set("code"), "Comparing its code with the published hash");
    toRow("The pinned build is public", checkBuild(url, hash), set("build"), "Downloading the bytes and hashing them here");
    return () => { alive = false; };
  }, [id, url, hash]);

  useEffect(() => {
    let alive = true;
    const set = (row: Row) => { if (alive) setRows((all) => ({ ...all, ledger: row })); };
    const parsed = JSON.parse(ledgerKey) as Business["ledger"];
    toRow(
      "Its books match its balance",
      checkSolvent({ id, ledger: parsed } as Business).then((c) => ({ ok: c.ok, detail: `Holds ${money(c.held)}, owes ${money(c.owed)}` })),
      set,
      "Comparing the token balance with the ledger",
    );
    return () => { alive = false; };
  }, [id, ledgerKey]);

  useEffect(() => {
    let alive = true;
    if (jobsDone === 0) return;
    latestAttestation(id).then((a) => { if (alive) setAttestation(a); }).catch(() => { if (alive) setAttestation(null); });
    return () => { alive = false; };
  }, [id, jobsDone]);

  const order = ["keys", "code", "build", "ledger"];
  return (
    <Panel title="Check it yourself" aside="Runs in your browser" id="proof">
      {listed === false ? (
        <p role="alert" className="mb-2 bg-[var(--yellow)] p-3 text-[15px]">This account is not in the Lien registry. Its figures may not mean what they say.</p>
      ) : null}
      <ul className="divide-y divide-[var(--line)]">
        {order.map((key) => (rows[key] ? <Result key={key} row={rows[key]} /> : null))}
        <AttestationRow attestation={jobsDone === 0 ? null : attestation} pinned={hash} jobsDone={jobsDone} />
      </ul>
      <dl className="dl mt-3 text-[14px]">
        <dt>Pinned build</dt><dd><a className="link" href={url} target="_blank" rel="noreferrer"><code>{shortHash(hash)}</code></a></dd>
        <dt>Contract code</dt><dd><code>{shortHash(deployment.agentCode)}</code></dd>
        <dt>Compute</dt><dd><AccountLink id={b.outlayer} /></dd>
        {b.source_url ? (<><dt>Source</dt><dd><a className="link" href={b.source_url} target="_blank" rel="noreferrer">Read the code</a></dd></>) : null}
      </dl>
    </Panel>
  );
}

function AttestationRow({ attestation, pinned, jobsDone }: { attestation: Attestation | null | undefined; pinned: string; jobsDone: number }) {
  if (attestation === undefined) return <Result row={{ label: "Work ran in a secure enclave", state: "checking", detail: "Finding the latest Intel TDX attestation" }} />;
  if (attestation === null) {
    return <Result row={{ label: "Work ran in a secure enclave", state: "unknown", detail: jobsDone === 0 ? "No jobs have run yet." : "No attestation was found among recent transactions." }} />;
  }
  const matches = attestation.executed_wasm_sha256 === pinned;
  return (
    <li className="grid grid-cols-[1fr_auto] gap-x-4 py-[10px]" data-testid="proof-row" data-state={matches ? "ok" : "fail"}>
      <div className="min-w-0">
        <p className="text-[15px]">Work ran in a secure enclave</p>
        <p className="text-[14px] muted">
          {matches ? "The latest Intel TDX quote names the pinned build. " : "The latest quote names a different build. "}
          <a className="link" href={attestationUrl(attestation.transaction_hash)} target="_blank" rel="noreferrer">See the quote</a>{" · "}
          <a className="link" href={txUrl(attestation.transaction_hash)} target="_blank" rel="noreferrer">See the transaction</a>
        </p>
      </div>
      <p className="text-[14px] font-medium" style={{ color: matches ? "var(--ok)" : "var(--danger)" }}>{matches ? "Verified" : "Failed"}</p>
    </li>
  );
}
