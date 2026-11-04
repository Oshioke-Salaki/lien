"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { AmountField, TextField } from "@/components/business/fields";
import { ConnectGate, useTx } from "@/components/Tx";
import { Panel } from "@/components/ui";
import { CREATE_DEPOSIT_NEAR, deployment, REPO_URL } from "@/lib/config";
import { money, parseAmount, shortHash, toYocto } from "@/lib/format";
import { createBusiness } from "@/lib/near/actions";
import { accountExists } from "@/lib/near/rpc";
import type { Service } from "@/lib/near/types";
import { useWallet } from "@/lib/wallet/WalletProvider";

const LABEL = /^[a-z0-9](?:[a-z0-9]|-(?!-))*[a-z0-9]$/;

export function CreateScreen() {
  const router = useRouter();
  const { account } = useWallet();
  const { run, busy } = useTx();
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
    const result = await run(
      createBusiness({ label, name: name.trim(), description: description.trim(), sourceUrl: REPO_URL, service, depositYocto: toYocto(CREATE_DEPOSIT_NEAR) }),
      { done: `${name} is live` },
    );
    if (result?.events.some((e) => e.event === "agent_created")) router.push(`/b/${label}.${deployment.registry}`);
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[28px] leading-tight font-medium tracking-[-0.01em]">Start a business</h1>
        <p className="mt-1 max-w-[70ch] text-[17px]">You get a keyless account that runs your build, sells its work and can borrow against what it earns. You keep control until you take a loan.</p>
      </div>
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_372px]">
        <Panel>
          <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); void submit(); }} data-testid="create-form">
            <TextField label="Account name" testId="create-label" value={label} onChange={(v) => setLabel(v.toLowerCase())} placeholder="scout"
              error={labelError ?? (taken ? "That name is taken." : null)}
              hint={label && !labelError && taken === false ? `${label}.${deployment.registry} is free. Income arrives at ${label}-in.${deployment.registry}.` : `Becomes <name>.${deployment.registry}`} />
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField label="Business name" testId="create-name" value={name} onChange={setName} />
              <AmountField label="Price of one job" testId="create-price" value={price} onChange={setPrice} error={priceValue === null && price ? "Enter an amount." : null} />
            </div>
            <TextField label="What it does" value={description} onChange={setDescription} multiline />
            <TextField label="Vendors it may pay" value={vendors} onChange={setVendors} error={vendorError} hint="Accounts, separated by commas. It can pay nobody else, whatever its code asks." />
            <div className="grid gap-4 sm:grid-cols-2">
              <AmountField label="Most per payment" value={perTx} onChange={setPerTx} error={limitError} />
              <AmountField label="Most per day" value={perDay} onChange={setPerDay} />
            </div>
            <details>
              <summary className="cursor-pointer text-[15px] font-medium">Use your own build</summary>
              <div className="mt-3 space-y-3">
                <p className="hint">Starts with Sentinel, whose source is in the repository. To run yours, publish it to FastFS and paste its URL and SHA-256 here.</p>
                <TextField label="Build URL" value={url} onChange={setUrl} error={urlError} />
                <TextField label="SHA-256 of the build" value={hash} onChange={setHash} error={hashError} />
              </div>
            </details>
            <ConnectGate reason="Connect to create it. The account that creates a business operates it.">
              <button type="submit" className="btn btn-primary w-full sm:w-auto" data-testid="create-submit" disabled={!ready || busy}>Create it for {CREATE_DEPOSIT_NEAR} NEAR</button>
            </ConnectGate>
          </form>
        </Panel>
        <Panel title="What you are creating">
          <dl className="dl">
            <dt>Keys on the account</dt><dd>None, ever</dd>
            <dt>Contract</dt><dd><code>{shortHash(deployment.agentCode)}</code></dd>
            <dt>Build it runs</dt><dd><code>{hash ? shortHash(hash) : "-"}</code></dd>
            <dt>Job price</dt><dd>{priceValue ? money(priceValue) : "-"}</dd>
            <dt>Cost</dt><dd>{CREATE_DEPOSIT_NEAR} NEAR</dd>
          </dl>
          <p className="mt-3 text-[14px] muted">Most of that NEAR stays in the business to pay for its compute. Without a loan you can withdraw it.</p>
        </Panel>
      </div>
    </div>
  );
}
