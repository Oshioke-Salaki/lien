"use client";

import { useId } from "react";
import { useLive } from "@/hooks/useLive";
import { CENT, money, moneyUp, parseAmount } from "@/lib/format";
import { isRegistered, tokenBalance } from "@/lib/near/rpc";
import { useWallet } from "@/lib/wallet/WalletProvider";

export function useMyBalance() {
  const { account } = useWallet();
  return useLive(account ? async () => ((await isRegistered(account)) ? tokenBalance(account) : 0n) : null, `my-balance:${account}`, 8_000);
}

export type AmountCheck = { value: bigint | null; error: string | null };

export function checkAmount(text: string, { min, max, balance }: { min?: bigint; max?: bigint; balance?: bigint }): AmountCheck {
  if (text.trim() === "") return { value: null, error: null };
  const clean = text.trim().replace(/,/g, "");
  if (/^-/.test(clean)) return { value: null, error: "Enter a positive amount, like 12.50." };
  if (/\.\d{3,}$/.test(clean)) return { value: null, error: "Use at most two decimal places, like 12.50." };
  const value = parseAmount(text);
  if (value === null) return { value: null, error: "Enter an amount in dollars, like 12.50." };
  if (value === 0n) return { value: null, error: "Enter more than zero." };
  if (value < CENT) return { value, error: "The smallest amount is $0.01." };
  if (min !== undefined && value < min) return { value, error: `The minimum is ${moneyUp(min)}.` };
  if (max !== undefined && value > max) return { value, error: `The maximum is ${money(max)}.` };
  if (balance !== undefined && value > balance) return { value, error: `You hold ${money(balance)}.` };
  return { value, error: null };
}

/** An amount in dollars by default ("$" before the number, as on any banking app), or in another unit. */
export function AmountField({ label, value, onChange, error, hint, testId, unit }: { label: string; value: string; onChange: (v: string) => void; error?: string | null; hint?: string; testId?: string; unit?: string }) {
  const id = useId();
  const described = error || hint ? `${id}-hint` : undefined;
  return (
    <label className="field" htmlFor={id}>
      <span>{label}</span>
      <div className="relative">
        {unit ? null : <span aria-hidden className="pointer-events-none absolute top-1/2 left-[14px] -translate-y-1/2 text-[16px] text-[var(--ink-2)]">$</span>}
        <input id={id} data-testid={testId} className={`input ${unit ? "pr-16" : "pl-7"}`} inputMode="decimal" autoComplete="off" placeholder="0.00" value={value} aria-invalid={!!error} aria-describedby={described} onChange={(e) => onChange(e.target.value)} />
        {unit ? <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-[14px] muted">{unit}</span> : null}
      </div>
      {error || hint ? <p id={described} className="hint" data-error={!!error}>{error ?? hint}</p> : null}
    </label>
  );
}

export function TextField({ label, value, onChange, error, hint, placeholder, testId, multiline }: { label: string; value: string; onChange: (v: string) => void; error?: string | null; hint?: string; placeholder?: string; testId?: string; multiline?: boolean }) {
  const id = useId();
  const described = error || hint ? `${id}-hint` : undefined;
  return (
    <label className="field" htmlFor={id}>
      <span>{label}</span>
      {multiline ? (
        <textarea id={id} data-testid={testId} className="input" value={value} placeholder={placeholder} aria-invalid={!!error} aria-describedby={described} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <input id={id} data-testid={testId} className="input" value={value} placeholder={placeholder} autoComplete="off" spellCheck={false} aria-invalid={!!error} aria-describedby={described} onChange={(e) => onChange(e.target.value)} />
      )}
      {error || hint ? <p id={described} className="hint" data-error={!!error}>{error ?? hint}</p> : null}
    </label>
  );
}

const UNITS = [
  { label: "minutes", secs: 60 },
  { label: "hours", secs: 3_600 },
  { label: "days", secs: 86_400 },
];

export function DurationField({ label, secs, onChange, hint, testId }: { label: string; secs: number; onChange: (secs: number) => void; hint?: string; testId?: string }) {
  const id = useId();
  const unit = [...UNITS].reverse().find((u) => secs >= u.secs && secs % u.secs === 0) ?? UNITS[0]!;
  return (
    <div className="field">
      <label htmlFor={id} className="mb-[6px] block text-[14px]">{label}</label>
      <div className="flex gap-2">
        <input
          id={id}
          data-testid={testId}
          className="input num"
          inputMode="numeric"
          value={secs === 0 ? "0" : String(secs / unit.secs)}
          onChange={(e) => {
            const n = Number(e.target.value.replace(/[^\d]/g, ""));
            onChange(Number.isFinite(n) ? n * unit.secs : 0);
          }}
        />
        <select aria-label={`${label} unit`} className="input w-auto" value={unit.secs} onChange={(e) => onChange((secs / unit.secs) * Number(e.target.value))}>
          {UNITS.map((u) => <option key={u.secs} value={u.secs}>{u.label}</option>)}
        </select>
      </div>
      {hint ? <p className="hint">{hint}</p> : null}
    </div>
  );
}
