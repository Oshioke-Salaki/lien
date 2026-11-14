"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { AmountField, checkAmount, TextField } from "@/components/business/fields";
import { ConnectGate, useTx } from "@/components/Tx";
import { PageHead, Panel } from "@/components/ui";
import { CREATE_DEPOSIT_NEAR, deployment, REPO_URL } from "@/lib/config";
import { isPayableAccount, labelProblem } from "@/lib/accounts";
import { money, shortHash, toYocto } from "@/lib/format";
import { createBusiness } from "@/lib/near/actions";
import { accountExists } from "@/lib/near/rpc";
import { checkBuild } from "@/lib/near/proof";
import type { Service } from "@/lib/near/types";
import { useGuestCapacity } from "@/hooks/useGuestCapacity";
import { GUEST_PAUSED } from "@/lib/guestCapacity";
import { topUpGuest } from "@/lib/wallet/guest";
import { useWallet } from "@/lib/wallet/WalletProvider";

const UNIT = 10n ** BigInt(deployment.tokenDecimals);
/** A sale above this is almost certainly a typo on a test network. */
const MAX_PRICE = 1_000n * UNIT;
/** The most a business may spend in a day on a test network. */
const MAX_PER_DAY = 1_000n * UNIT;

export function CreateScreen() {
  const router = useRouter();
  const { account, kind } = useWallet();
  const { run, busy } = useTx();
  const [preparing, setPreparing] = useState(false);
  const [prepareError, setPrepareError] = useState<string | null>(null);
  const sentinel = deployment.sentinel;
  const [label, setLabel] = useState("");
  const [name, setName] = useState("");
  // Names already in the market, so two businesses never share one.
  const [usedNames, setUsedNames] = useState<Set<string> | null>(null);
  useEffect(() => {
    let alive = true;
    fetch("/api/market", { signal: AbortSignal.timeout(15_000) })
      .then((r) => r.json() as Promise<{ businesses?: Array<{ name: string }> }>)
      .then((snap) => { if (alive) setUsedNames(new Set((snap.businesses ?? []).map((b) => b.name.trim().toLowerCase()))); })
      .catch(() => undefined);
    return () => { alive = false; };
  }, []);
  const capacity = useGuestCapacity();
  const depositCovered = kind === "guest" && capacity?.businesses !== 0;
  const guestPaused = kind === "guest" && capacity?.businesses === 0;
  const [description, setDescription] = useState("Checks a NEAR account before an agent pays or signs.");
  const [price, setPrice] = useState("0.25");
  const [url, setUrl] = useState(sentinel?.url ?? "");
  const [hash, setHash] = useState(sentinel?.hash ?? "");
  // Empty to start: a vendor is a choice the owner makes. Sentinel's own vendor is one click away below.
  const [vendors, setVendors] = useState("");
  const [perTx, setPerTx] = useState("0.10");
  const [perDay, setPerDay] = useState("5");
  // Keyed by name, so a stale answer about the previous name is never shown.
  const [availability, setAvailability] = useState<{ label: string; taken: boolean } | null>(null);

  const labelError = label ? labelProblem(label) : null;

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

  const vendorList = useMemo(() => vendors.split(/,/).map((v) => v.trim().toLowerCase()).filter(Boolean), [vendors]);
  const badVendors = vendorList.filter((v) => !isPayableAccount(v));
  // Each vendor must exist, checked once typing pauses. Keyed by the list, so a stale answer never shows.
  const [vendorCheck, setVendorCheck] = useState<{ key: string; missing: string[] } | null>(null);
  const vendorKey = vendorList.join(",");
  useEffect(() => {
    if (!vendorList.length || badVendors.length) return;
    let alive = true;
    const timer = setTimeout(async () => {
      const results = await Promise.all(vendorList.map(async (v) => ({ v, ok: await accountExists(v).catch(() => true) })));
      if (alive) setVendorCheck({ key: vendorKey, missing: results.filter((r) => !r.ok).map((r) => r.v) });
    }, 400);
    return () => { alive = false; clearTimeout(timer); };
    // vendorKey stands for the list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vendorKey]);
  const missingVendors = vendorCheck?.key === vendorKey ? vendorCheck.missing : [];
  const emptyVendor = vendors.trim() !== "" && vendors.split(",").some((v) => v.trim() === "");
  const duplicateVendor = vendorList.find((v, i) => vendorList.indexOf(v) !== i);
  const vendorError = emptyVendor ? "There is an empty item between commas. Remove the extra comma."
    : duplicateVendor ? `${duplicateVendor} is listed twice. Name each vendor once.`
    : badVendors.length
    ? `${badVendors.length === 1 ? `"${badVendors[0]}" is not` : `${badVendors.length} of these are not`} a NEAR account name. Account names look like vendor.testnet; separate several with commas.`
    : missingVendors.length ? `There is no account called ${missingVendors[0]} on this network.`
    : account && vendorList.includes(account) ? "You cannot be your own vendor: lenders would never accept it, and the contract refuses it." : null;
  const trimmedName = name.trim();
  const nameError = !trimmedName ? "Give it a name customers will see." : trimmedName.length < 2 ? "Use at least 2 characters." : trimmedName.length > 40 ? "Use at most 40 characters." : !/^[\p{L}\p{N} .,'&()-]+$/u.test(trimmedName) ? "Use letters, numbers, spaces and simple punctuation."
    : usedNames?.has(trimmedName.toLowerCase()) ? `Another business is already called ${trimmedName}. Pick a name of its own, so customers can tell them apart.` : null;
  const priceCheck = price.trim() === "" ? { value: null, error: "Set a price for one sale." } : checkAmount(price, { max: MAX_PRICE });
  const priceValue = priceCheck.error ? null : priceCheck.value;
  const perTxCheck = perTx.trim() === "" ? { value: 0n, error: null } : checkAmount(perTx, {});
  const perDayCheck = perDay.trim() === "" ? { value: 0n, error: null } : checkAmount(perDay, { max: MAX_PER_DAY });
  const perTxValue = perTxCheck.error ? null : perTxCheck.value ?? 0n;
  const perDayValue = perDayCheck.error ? null : perDayCheck.value ?? 0n;
  const descriptionError = !description.trim() ? "Say in a line what it sells, so customers and lenders know." : description.length > 500 ? "Keep it under 500 characters." : null;
  const hashError = hash && !/^[0-9a-f]{64}$/.test(hash) ? "64 lowercase hex characters." : /^0{64}$/.test(hash) ? "That is not a real fingerprint." : null;
  const urlError = url && !/^https:\/\/[^\s/]+\.[^\s]+$/.test(url) ? "A full https:// address of the program file." : null;

  // The program is downloaded and fingerprinted here before anything is signed: a business must
  // run exactly the file its fingerprint names. Keyed by both, so a stale answer never shows.
  const [program, setProgram] = useState<{ key: string; state: "ok" | "mismatch" | "unreachable" } | null>(null);
  const programKey = `${url}|${hash}`;
  useEffect(() => {
    if (!url || !hash || hashError || urlError) return;
    let alive = true;
    const timer = setTimeout(async () => {
      const result = await checkBuild(url, hash).then((c) => (c.ok ? "ok" : /could not be fetched/.test(c.detail) ? "unreachable" : "mismatch") as "ok" | "mismatch" | "unreachable", () => "unreachable" as const);
      if (alive) setProgram({ key: programKey, state: result });
    }, 500);
    return () => { alive = false; clearTimeout(timer); };
    // programKey stands for the url and hash.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [programKey, hashError, urlError]);
  const programState = program?.key === programKey ? program.state : null;
  const programError = programState === "mismatch" ? "The file at that address does not match this fingerprint." : programState === "unreachable" ? "Couldn't check the program file: its address did not answer." : null;
  const limitError = perTxValue !== null && perDayValue !== null && perTxValue > perDayValue ? "The limit per payment cannot be above the daily limit." : null;

  // The first thing still missing, said plainly next to the button.
  const blocker = guestPaused ? GUEST_PAUSED
    : !label ? "Choose an account name to continue."
    : labelError ? `Account name: ${labelError}`
    : taken === null ? "Checking that the account name is free…"
    : taken ? "That account name is taken. Try another."
    : nameError ? `Business name: ${nameError}`
    : priceCheck.error ? `Price: ${priceCheck.error}`
    : descriptionError ? `Description: ${descriptionError}`
    : vendorError ? `Vendors: ${vendorError}`
    : perTxCheck.error ? `Most per payment: ${perTxCheck.error}`
    : perDayCheck.error ? `Most per day: ${perDayCheck.error}`
    : limitError ? limitError
    : !url || !hash || hashError || urlError ? "Its program: check the build URL and its SHA-256."
    : programError ? `Its program: ${programError}`
    : programState === null ? "Checking its program file…"
    : null;
  const ready = blocker === null && priceValue !== null && perTxValue !== null && perDayValue !== null;

  const submit = async () => {
    if (!ready || perTxValue === null || perDayValue === null || priceValue === null) return;
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
            <TextField label="Business name" testId="create-name" value={name} onChange={setName} error={name !== "" ? nameError : null} placeholder="A name of its own, like Harbor Checks" />
          </>)}
          {step("What it sells", "One service at one price. Customers pay the business, which holds the money until the work is done, and refunds it if the work fails.", <>
            <AmountField label="Price of one sale" testId="create-price" value={price} onChange={setPrice} error={priceCheck.error} hint="Up to $1,000 a sale." />
            <TextField label="What it does" value={description} onChange={setDescription} multiline error={descriptionError} />
          </>)}
          {step("What it may spend on", "It can only pay these accounts, up to these limits, whatever its program asks for. This is what keeps a loan safe.", <>
            <TextField label="Vendors it may pay" testId="create-vendors" value={vendors} onChange={(v) => setVendors(v.toLowerCase())} error={vendorError} placeholder="e.g. compute-provider.testnet" hint={vendorList.length ? "Accounts it may pay, separated by commas." : "NEAR accounts it may pay, separated by commas. With none, it can't pay anyone for its work, such as the service it buys compute from."} />
            {sentinel?.vendor && !vendorList.includes(sentinel.vendor) ? (
              <button type="button" className="link -mt-1 block text-left text-[14px]" data-testid="create-vendor-sentinel" onClick={() => setVendors(vendorList.length ? `${vendors.replace(/[,\s]+$/, "")}, ${sentinel.vendor}` : sentinel.vendor!)}>
                Running Sentinel&rsquo;s program? Add the vendor it pays, <span className="whitespace-nowrap">{sentinel.vendor}</span>
              </button>
            ) : null}
            <div className="grid gap-4 sm:grid-cols-2">
              <AmountField label="Most per payment" value={perTx} onChange={setPerTx} error={perTxCheck.error ?? limitError} hint={perTx.trim() === "" ? "Left empty, the limit is $0: its program will not be able to pay any vendor." : undefined} />
              <AmountField label="Most per day" value={perDay} onChange={setPerDay} error={perDayCheck.error} />
            </div>
          </>)}
          {step("Its program", "It starts with Sentinel, our open example agent that sells safety checks. Paste your own to run something else.", <>
            <details>
              <summary className="cursor-pointer rounded-[10px] bg-[var(--surface-2)] px-4 py-3 text-[15px] font-medium transition-colors hover:bg-[var(--surface-3)]">Use your own program</summary>
              <div className="mt-4 space-y-4">
                <p className="hint">Publish it to FastFS and paste its URL and SHA-256. Sentinel&rsquo;s source is in the repository.</p>
                <TextField label="Build URL" value={url} onChange={setUrl} error={urlError} />
                <TextField label="SHA-256 of the build" value={hash} onChange={(v) => setHash(v.trim().toLowerCase())} error={hashError ?? programError} hint={programState === "ok" ? "Checked: the file matches this fingerprint." : undefined} />
              </div>
            </details>
          </>)}
          <div className="rounded-[16px] bg-[var(--surface)] p-5 sm:p-6">
            <ConnectGate reason="Connect to create it. The account that creates a business owns it.">
              <div className="flex flex-wrap items-center gap-4">
                <button type="submit" className="btn btn-primary w-full sm:w-auto" data-testid="create-submit" disabled={!ready || busy || preparing}>{preparing ? "Preparing your account…" : kind === "guest" ? "Create it, free on your test account" : `Create it for ${CREATE_DEPOSIT_NEAR} NEAR`}</button>
                <p className="text-[14px]" data-error={!!blocker} style={{ color: blocker ? "var(--warn)" : "var(--ink-2)" }}>
                  {blocker ?? (depositCovered ? `Ready. The one-time ${CREATE_DEPOSIT_NEAR} NEAR network deposit is covered for you; it takes about 20 seconds.` : "Ready. Your wallet will ask you to confirm.")}
                </p>
              </div>
              {prepareError ? <p role="alert" className="hint" data-error="true">{prepareError}</p> : null}
            </ConnectGate>
          </div>
        </form>
        <aside className="space-y-4 xl:sticky xl:top-10">
          <Panel title="What you are creating">
            <p className="mb-4 text-[15px] leading-snug text-[var(--ink-2)]">
              {name.trim() || "Your business"} sells one job for {priceValue ? money(priceValue) : "its price"}, at {label && !labelError ? <code>{label}.{deployment.registry}</code> : "its own account"}. It can pay {vendorList.length ? vendorList.length === 1 ? "one vendor" : `${vendorList.length} vendors` : "nobody"}, {perDayValue !== null ? `at most ${money(perDayValue)} a day` : "up to the daily limit you set"}.
            </p>
            <dl className="dl">
              <dt>Keys on the account</dt><dd>None, ever</dd>
              <dt>Contract</dt><dd title={`Code hash ${deployment.agentCode}`}>Runs the standard Lien contract</dd>
              <dt>Build it runs</dt><dd><code>{hash ? shortHash(hash) : "-"}</code></dd>
              <dt>Job price</dt><dd>{priceValue ? money(priceValue) : "-"}</dd>
              <dt>Network deposit</dt><dd>{depositCovered ? "Covered for you" : guestPaused ? "Paused: test funds are being refilled" : `${CREATE_DEPOSIT_NEAR} NEAR`}</dd>
            </dl>
            <p className="mt-4 text-[14px] leading-snug muted">
              NEAR is the network&rsquo;s own currency, used for fees. Creating a business takes a one-time {CREATE_DEPOSIT_NEAR} NEAR deposit, which mostly stays in the business to pay for its computing.{depositCovered ? " On a free test account it is covered for you." : guestPaused ? " Free test accounts can't cover it right now, while we refill test funds." : " Without a loan you can withdraw it."}
            </p>
          </Panel>
        </aside>
      </div>
    </div>
  );
}
