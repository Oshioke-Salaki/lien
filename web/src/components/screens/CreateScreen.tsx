"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { AmountField, TextField } from "@/components/business/fields";
import { ConnectGate, useTx } from "@/components/Tx";
import { PageHead, Panel } from "@/components/ui";
import { CREATE_DEPOSIT_NEAR, deployment, REPO_URL } from "@/lib/config";
import { money, parseAmount, shortHash, toYocto } from "@/lib/format";
import { createBusiness } from "@/lib/near/actions";
import { accountExists } from "@/lib/near/rpc";
import type { Service } from "@/lib/near/types";
import { topUpGuest } from "@/lib/wallet/guest";
import { useWallet } from "@/lib/wallet/WalletProvider";

const LABEL = /^[a-z0-9](?:[a-z0-9]|-(?!-))*[a-z0-9]$/;

export function CreateScreen() {
  const router = useRouter();
  const { account, kind } = useWallet();
  const { run, busy } = useTx();
  const [preparing, setPreparing] = useState(false);
  const [prepareError, setPrepareError] = useState<string | null>(null);
  const sentinel = deployment.sentinel;
  const [label, setLabel] = useState("");
  const [name, setName] = useState("Sentinel");
  const [description, setDescription] = useState("Checks a NEAR account before an agent pays or signs.");
  const [price, setPrice] = useState("0.25");
  const [url, setUrl] = useState(sentinel?.url ?? "");
  const [hash, setHash] = useState(sentinel?.hash ?? "");
  const [vendors, setVendors] = useState(sentinel?.vendor ?? "");
  const [perTx, setPerTx] = useState("0.10");
  const [perDay, setPerDay] = useState("5");
  // Keyed by name, so a stale answer about the previous name is never shown.
  const [availability, setAvailability] = useState<{ label: string; taken: boolean } | null>(null);

  const labelError = label && (label.length < 2 || label.length > 32 || !LABEL.test(label)) ? "2 to 32 lowercase letters, digits or single hyphens." : null;

  const taken = availability?.label === label ? availability.taken : null;

  useEffect(() => {
    if (!label || labelError) return;
    let alive = true;
    const timer = setTimeout(async () => {
      const exists = await accountExists(`${label}.${deployment.registry}`).catch(() => false);
      if (alive) setAvailability({ label, taken: exists });
    }, 350);
    return () => { alive = false; clearTimeout(timer); };
  }, [label, labelError]);

  const vendorList = useMemo(() => vendors.split(/[\s,]+/).filter(Boolean), [vendors]);
  const vendorError = account && vendorList.includes(account) ? "You cannot be your own vendor: lenders would never accept it, and the contract refuses it." : null;
  const priceValue = parseAmount(price);
  const perTxValue = parseAmount(perTx === "" ? "0" : perTx);
  const perDayValue = parseAmount(perDay === "" ? "0" : perDay);
  const hashError = hash && !/^[0-9a-f]{64}$/.test(hash) ? "64 lowercase hex characters." : null;
  const urlError = url && !url.startsWith("https://") ? "Must start with https://" : null;
  const limitError = perTxValue !== null && perDayValue !== null && perTxValue > perDayValue ? "The limit per payment cannot be above the daily limit." : null;

  const ready = label && !labelError && taken === false && name.trim() && priceValue && priceValue > 0n && url && hash && !hashError && !urlError && !vendorError && !limitError && perTxValue !== null && perDayValue !== null;

  const submit = async () => {
    if (!ready || perTxValue === null || perDayValue === null || !priceValue) return;
    const service: Service = {
      wasm: { url, hash, build_target: sentinel?.buildTarget ?? "wasm32-wasip2" },
      price: priceValue.toString(),
      max_instructions: 10_000_000_000,
      max_memory_mb: 128,
      max_execution_seconds: 60,
      compute_deposit: toYocto("0.02"),
      secrets_profile: null,
      policy: { vendors: vendorList, max_per_tx: perTxValue.toString(), max_per_day: perDayValue.toString() },
    };
    if (kind === "guest" && account) {
      setPreparing(true);
      try {
        await topUpGuest(account);
      } catch (error) {
        setPrepareError(error instanceof Error ? error.message : "Your test account could not be topped up.");
        return;
      } finally {
        setPreparing(false);
      }
    }
    const result = await run(
      createBusiness({ label, name: name.trim(), description: description.trim(), sourceUrl: REPO_URL, service, depositYocto: toYocto(CREATE_DEPOSIT_NEAR) }),
      { done: `${name} is live` },
    );
    if (result?.events.some((e) => e.event === "agent_created")) router.push(`/b/${label}.${deployment.registry}`);
  };

  const step = (title: string, body: string, children: React.ReactNode) => (
    <section className="grid gap-5 rounded-[16px] bg-[var(--surface)] p-5 sm:p-6 lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-8">
      <div>
        <h2 className="text-[17px] font-medium tracking-[-0.01em]">{title}</h2>
        <p className="mt-1 text-[14px] leading-snug muted">{body}</p>
      </div>
      <div className="min-w-0 space-y-4">{children}</div>
    </section>
  );

  return (
    <div className="space-y-8">
      <PageHead title="Start a business" lead="Set up an AI business that sells a service and can borrow against its sales. Nobody holds its keys, not even you, which is why lenders can trust it. It takes about a minute." />
      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); void submit(); }} data-testid="create-form">
          {step("Its name", "The account name is permanent. The business name is what customers see.", <>
            <TextField label="Account name" testId="create-label" value={label} onChange={(v) => setLabel(v.toLowerCase())} placeholder="scout"
              error={labelError ?? (taken ? "That name is taken." : null)}
              hint={label && !labelError && taken === false ? `${label}.${deployment.registry} is free. Income arrives at ${label}-in.${deployment.registry}.` : label && !labelError ? "Checking the name…" : `Becomes <name>.${deployment.registry}`} />
            <TextField label="Business name" testId="create-name" value={name} onChange={setName} />
          </>)}
          {step("What it sells", "One service at one price. Customers pay the business, which holds the money until the work is done, and refunds it if the work fails.", <>
            <AmountField label="Price of one sale" testId="create-price" value={price} onChange={setPrice} error={priceValue === null && price ? "Enter an amount." : null} />
            <TextField label="What it does" value={description} onChange={setDescription} multiline />
          </>)}
          {step("What it may spend on", "It can only pay these accounts, up to these limits, whatever its program asks for. This is what keeps a loan safe.", <>
            <TextField label="Vendors it may pay" value={vendors} onChange={setVendors} error={vendorError} hint="Accounts, separated by commas." />
            <div className="grid gap-4 sm:grid-cols-2">
              <AmountField label="Most per payment" value={perTx} onChange={setPerTx} error={limitError} />
              <AmountField label="Most per day" value={perDay} onChange={setPerDay} />
            </div>
          </>)}
          {step("Its program", "It starts with Sentinel, our open example agent that sells safety checks. Paste your own to run something else.", <>
            <details>
              <summary className="cursor-pointer rounded-[10px] bg-[var(--surface-2)] px-4 py-3 text-[15px] font-medium transition-colors hover:bg-[var(--surface-3)]">Use your own program</summary>
              <div className="mt-4 space-y-4">
                <p className="hint">Publish it to FastFS and paste its URL and SHA-256. Sentinel&rsquo;s source is in the repository.</p>
                <TextField label="Build URL" value={url} onChange={setUrl} error={urlError} />
                <TextField label="SHA-256 of the build" value={hash} onChange={setHash} error={hashError} />
              </div>
            </details>
          </>)}
          <div className="rounded-[16px] bg-[var(--surface)] p-5 sm:p-6">
            <ConnectGate reason="Connect to create it. The account that creates a business owns it.">
              <div className="flex flex-wrap items-center gap-4">
                <button type="submit" className="btn btn-primary w-full sm:w-auto" data-testid="create-submit" disabled={!ready || busy || preparing}>{preparing ? "Preparing your account…" : `Create it for ${CREATE_DEPOSIT_NEAR} NEAR`}</button>
                <p className="text-[14px] muted">{ready ? "Your wallet asks you to confirm." : "Fill in a free name to continue."}</p>
              </div>
              {prepareError ? <p role="alert" className="hint" data-error="true">{prepareError}</p> : null}
            </ConnectGate>
          </div>
        </form>
        <aside className="space-y-4 xl:sticky xl:top-10">
          <Panel title="What you are creating">
            <p className="mb-4 text-[15px] leading-snug text-[var(--ink-2)]">
              {name.trim() || "Your business"} sells one job for {priceValue ? money(priceValue) : "its price"}, at {label && !labelError ? <code>{label}.{deployment.registry}</code> : "its own account"}. It can pay {vendorList.length ? vendorList.length === 1 ? "one vendor" : `${vendorList.length} vendors` : "nobody"}, at most {perDayValue !== null ? money(perDayValue) : "-"} a day.
            </p>
            <dl className="dl">
              <dt>Keys on the account</dt><dd>None, ever</dd>
              <dt>Contract</dt><dd><code>{shortHash(deployment.agentCode)}</code></dd>
              <dt>Build it runs</dt><dd><code>{hash ? shortHash(hash) : "-"}</code></dd>
              <dt>Job price</dt><dd>{priceValue ? money(priceValue) : "-"}</dd>
              <dt>Cost</dt><dd>{CREATE_DEPOSIT_NEAR} NEAR</dd>
            </dl>
            <p className="mt-4 text-[14px] leading-snug muted">Most of that NEAR stays in the business to pay for its compute. Without a loan you can withdraw it.</p>
          </Panel>
        </aside>
      </div>
    </div>
  );
}
