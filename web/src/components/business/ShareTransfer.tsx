"use client";

import { useState } from "react";
import { useTx } from "@/components/Tx";
import { money } from "@/lib/format";
import { transferNote } from "@/lib/near/actions";
import { accountExists, viewAccount } from "@/lib/near/rpc";
import { useWallet } from "@/lib/wallet/WalletProvider";

/** A NEAR account id: named (bob.testnet, a.b.near) or a 64-character implicit one. */
const ACCOUNT_ID = /^(?=.{2,64}$)(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;

/** Checks a recipient before anything is signed: its form, that it is not you, and that it exists. */
export async function checkRecipient(raw: string, self: string | null): Promise<{ id?: string; error?: string; notes?: string[] }> {
  const id = raw.trim().toLowerCase();
  if (!id) return { error: "Type the account that should receive your share." };
  if (/\s/.test(id) || !ACCOUNT_ID.test(id)) return { error: "That isn't a NEAR account name. Account names look like bob.testnet." };
  if (id === self) return { error: "That is your own account." };
  try {
    if (!(await accountExists(id))) return { error: `There is no account called ${id} on the test network. Check the spelling.` };
  } catch {
    // A network error is not a "yes": nothing is sent until the account is confirmed.
    return { error: "We couldn't check that account just now. Try again in a moment." };
  }
  const notes: string[] = [];
  if (id !== raw.trim()) notes.push(`NEAR account names are lowercase, so this goes to ${id}.`);
  // An account running code is a program: unless it was built to hold loan shares, the share may be stuck there.
  const code = await viewAccount(id).then((a) => a.global_contract_hash ?? a.code_hash).catch(() => null);
  if (code && code !== NO_CODE) notes.push("That account runs a program. Only send your share there if that program is built to receive and pass on loan shares; otherwise the repayments could be stuck for good.");
  return { id, notes };
}

/** The code hash NEAR reports for an account with no program on it. */
const NO_CODE = "11111111111111111111111111111111";

/**
 * Sends a whole share of a loan to someone else, the way a bank confirms a transfer:
 * check the recipient, show exactly what moves, then sign.
 */
export function ShareTransfer({ business, loanId, lent, ready, onDone }: { business: string; loanId: number; lent: bigint; ready: bigint; onDone: () => Promise<void> | void }) {
  const { run, busy } = useTx();
  const { account } = useWallet();
  const [to, setTo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [notes, setNotes] = useState<string[]>([]);
  const field = `to-${business}-${loanId}`;

  const review = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setChecking(true);
    const { id, error: problem, notes: found = [] } = await checkRecipient(to, account);
    setChecking(false);
    if (problem || !id) return setError(problem ?? "Check the account name.");
    setNotes(found);
    setConfirm(id);
  };

  const send = async () => {
    if (!confirm) return;
    const result = await run(transferNote(business, loanId, confirm), { requiredOn: business, done: `Your share was sent to ${confirm}` });
    if (result?.ok) {
      setConfirm(null);
      setTo("");
      await onDone();
    } else setConfirm(null);
  };

  if (confirm) {
    return (
      <div className="space-y-3 rounded-[12px] bg-[var(--surface-2)] p-4" data-testid="transfer-confirm" role="group" aria-label="Confirm the transfer">
        <p className="text-[15px] leading-snug">
          Send your whole share ({money(lent)} lent{ready > 0n ? `, plus ${money(ready)} not yet collected` : ""}) to <strong className="break-all">{confirm}</strong>?
        </p>
        <p className="text-[14px] text-[var(--ink-2)]">Every future repayment goes to them instead of you. This can&rsquo;t be undone.</p>
        {notes.map((note) => <p key={note} className="text-[14px] text-[var(--danger)]" data-testid="transfer-note-warning">{note}</p>)}
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void send()}>Yes, send it to {confirm.length > 24 ? "them" : confirm}</button>
          <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => setConfirm(null)}>Cancel</button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={review} className="grid gap-3 rounded-[12px] bg-[var(--surface-2)] p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end" data-testid="transfer-note" noValidate>
      <div className="grid min-w-0 gap-2">
        <label htmlFor={field} className="text-[14px]">Send your share of this loan to</label>
        <input id={field} className="input" value={to} onChange={(e) => { setTo(e.target.value); setError(null); }} placeholder="an account name, e.g. buyer.testnet" autoComplete="off" autoCapitalize="none" spellCheck={false} aria-invalid={!!error} aria-describedby={`${field}-help`} />
        <p id={`${field}-help`} className={`text-[14px] ${error ? "text-[var(--danger)]" : "muted"}`} role={error ? "alert" : undefined}>
          {error ?? (ready > 0n ? `Collect the ${money(ready)} that is ready first: anything not collected moves with your share.` : "The whole share moves, with every future repayment. Agree a price with them first.")}
        </p>
      </div>
      <button type="submit" className="btn btn-secondary" disabled={busy || checking}>{checking ? "Checking the account…" : "Review the transfer"}</button>
    </form>
  );
}
