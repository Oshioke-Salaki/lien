"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { ConnectButtons, useTx } from "@/components/Tx";
import { Mark } from "@/components/Mark";
import { deployment, isTestnet, NETWORK } from "@/lib/config";
import { money, shortAccount } from "@/lib/format";
import { faucet } from "@/lib/near/actions";
import { isRegistered, tokenBalance } from "@/lib/near/rpc";
import { useLive } from "@/hooks/useLive";
import { useWallet } from "@/lib/wallet/WalletProvider";

const NAV = [
  { href: "/market", label: "Market", icon: "M3 13h4v6H3zM10 8h4v11h-4zM17 4h4v15h-4z" },
  { href: "/portfolio", label: "Your positions", icon: "M4 6h16v12H4zM4 10h16M8 14h3" },
  { href: "/create", label: "Start a business", icon: "M12 5v14M5 12h14" },
  { href: "/guide", label: "Developer guide", icon: "M8 7l-5 5 5 5M16 7l5 5-5 5" },
];

function NavIcon({ d }: { d: string }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden className="shrink-0" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>
  );
}

function AccountBox({ quietWhenOut = false }: { quietWhenOut?: boolean }) {
  const { account, kind, disconnect, ready } = useWallet();
  const { run, busy } = useTx();
  const balance = useLive(account ? () => tokenBalance(account) : null, `balance:${account}`, 8_000);

  if (!ready) return <div className="skeleton h-[132px]" />;
  if (!account && quietWhenOut) {
    return <p className="rounded-[14px] bg-[var(--surface)] p-4 text-[14px] leading-snug text-[var(--ink-2)]">You are not connected yet. Nothing here needs a wallet to read.</p>;
  }
  if (!account) {
    return (
      <div className="space-y-3 rounded-[14px] bg-[var(--surface)] p-4">
        <div>
          <p className="text-[15px] font-medium">Take part</p>
          <p className="mt-1 text-[14px] leading-snug text-[var(--ink-2)]">Lend, buy and bid with a wallet, or try it with a free test account.</p>
        </div>
        <ConnectButtons compact />
      </div>
    );
  }

  const topUp = async () => {
    const prepare = async () => faucet(account, 100n * 10n ** BigInt(deployment.tokenDecimals), { register: !(await isRegistered(account)) });
    await run({ summary: "Get test funds", prepare }, { done: "100 test tokens added" });
    await balance.refresh();
  };

  return (
    <div className="space-y-3 rounded-[14px] bg-[var(--surface)] p-4 text-[14px]">
      <div className="flex items-center gap-3">
        <span aria-hidden className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[var(--accent-tint)] text-[14px] font-medium text-[var(--accent)]">{account.slice(0, 1).toUpperCase()}</span>
        <div className="min-w-0">
          <p className="truncate font-medium" title={account}>{shortAccount(account)}</p>
          <p className="muted">{kind === "guest" ? "Free test account in this browser" : "Connected wallet"}</p>
        </div>
      </div>
      <div>
        <p className="text-[13px] muted">Balance</p>
        <p className="num text-[22px] leading-tight font-medium tracking-[-0.01em]">{balance.data === undefined ? <span className="skeleton inline-block h-6 w-28 align-middle" /> : money(balance.data)}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {isTestnet ? (
          <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={topUp}>Get test funds</button>
        ) : null}
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => void disconnect()}>
          {kind === "guest" ? "Forget" : "Sign out"}
        </button>
      </div>
    </div>
  );
}

function NavLinks({ onNavigate, big = false }: { onNavigate?: () => void; big?: boolean }) {
  const path = usePathname();
  return (
    <nav aria-label="Main" className="space-y-1">
      {NAV.map((item) => {
        const active = path === item.href || (item.href === "/market" && path.startsWith("/b/"));
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={`flex items-center gap-3 rounded-[10px] px-3 transition-colors ${big ? "min-h-[56px] text-[18px]" : "min-h-[40px] text-[15px]"} ${active ? "bg-[var(--surface-2)] font-medium text-[var(--ink)]" : "text-[var(--ink-2)] hover:bg-[var(--surface)] hover:text-[var(--ink)]"}`}
          >
            <span className={active ? "text-[var(--accent)]" : "text-[var(--muted)]"}><NavIcon d={item.icon} /></span>
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

function NetworkNote() {
  return (
    <p className="flex items-center gap-2 text-[13px] muted">
      <span aria-hidden className="h-[7px] w-[7px] rounded-full bg-[var(--ok)]" />
      NEAR {NETWORK}. {isTestnet ? "Test money only." : "Real money."}
    </p>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const path = usePathname();
  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  return (
    <div className="min-h-svh bg-[var(--bg)]">
      {/* Phone and tablet: one bar with the name and the menu. */}
      <header className="sticky top-0 z-40 flex h-14 items-center justify-between border-b border-[var(--line)] bg-[var(--bg)] px-4 lg:hidden">
        <Link href="/" className="flex items-center gap-2 text-[17px] font-medium"><Mark size={22} /> Lien</Link>
        <button type="button" className="btn btn-ghost btn-sm min-h-[44px]" aria-expanded={open} aria-controls="app-menu" onClick={() => setOpen(!open)}>
          {open ? "Close" : "Menu"}
        </button>
      </header>
      {open ? (
        <div id="app-menu" className="appear fixed inset-x-0 top-14 bottom-0 z-40 flex flex-col justify-between gap-8 overflow-auto bg-[var(--bg)] p-4 pb-8 lg:hidden">
          <div className="space-y-4">
            <NavLinks big onNavigate={() => setOpen(false)} />
            <NetworkNote />
          </div>
          <AccountBox />
        </div>
      ) : null}

      <aside className="fixed inset-y-0 left-0 hidden w-[264px] flex-col justify-between overflow-y-auto border-r border-[var(--line)] p-4 lg:flex">
        <div className="space-y-6">
          <Link href="/" className="flex items-center gap-2 px-3 pt-2 text-[19px] font-medium tracking-[-0.01em]"><Mark size={22} /> Lien</Link>
          <NavLinks />
        </div>
        <div className="space-y-4">
          <div className="px-3"><NetworkNote /></div>
          <AccountBox quietWhenOut={path.startsWith("/b/")} />
        </div>
      </aside>

      <main className="px-4 pt-6 pb-24 sm:px-6 lg:ml-[264px] lg:px-10 lg:pt-10">
        <div className="mx-auto max-w-[1180px]">{children}</div>
      </main>
    </div>
  );
}
