"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { ConnectButtons, useTx } from "@/components/Tx";
import { Mark } from "@/components/Mark";
import { deployment, isTestnet, NETWORK } from "@/lib/config";
import { money, shortAccount } from "@/lib/format";
import { faucet } from "@/lib/near/actions";
import { isRegistered, tokenBalance } from "@/lib/near/rpc";
import { useLive } from "@/hooks/useLive";
import { useWallet } from "@/lib/wallet/WalletProvider";

const NAV = [
  { href: "/market", label: "Market" },
  { href: "/portfolio", label: "Your positions" },
  { href: "/create", label: "Start a business" },
  { href: "/guide", label: "Developer guide" },
];

function AccountBox() {
  const { account, kind, disconnect, ready } = useWallet();
  const { run, busy } = useTx();
  const balance = useLive(account ? () => tokenBalance(account) : null, `balance:${account}`, 8_000);

  if (!ready) return <div className="skeleton h-11" />;
  if (!account) return <ConnectButtons compact />;

  const topUp = async () => {
    const registered = await isRegistered(account);
    await run(faucet(account, 100n * 10n ** BigInt(deployment.tokenDecimals), { register: !registered }), { done: "100 test tokens added" });
    await balance.refresh();
  };

  return (
    <div className="space-y-2 text-[14px]">
      <div>
        <p className="font-medium break-all" title={account}>{shortAccount(account)}</p>
        <p className="muted">{kind === "guest" ? "Free test account in this browser" : "Connected wallet"}</p>
      </div>
      <p className="num">{balance.data === undefined ? "…" : money(balance.data)}</p>
      <div className="flex flex-wrap gap-2">
        {isTestnet ? (
          <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={topUp}>Get test funds</button>
        ) : null}
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => void disconnect()}>
          {kind === "guest" ? "Forget" : "Sign out"}
        </button>
      </div>
    </div>
  );
}

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const path = usePathname();
  return (
    <nav aria-label="Main" className="space-y-[2px]">
      {NAV.map((item) => {
        const active = path === item.href || (item.href === "/market" && path.startsWith("/b/"));
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={`block rounded-[2px] px-3 py-[6px] text-[15px] transition-colors ${active ? "bg-[#e9ece9] font-medium" : "hover:bg-[#f0f2f0]"}`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="min-h-svh bg-[var(--paper-sage)]">
      {/* Phone: a 48px bar with the name and a menu. */}
      <header className="sticky top-0 z-30 flex h-12 items-center justify-between bg-[var(--paper-sage)] px-4 lg:hidden">
        <Link href="/" className="flex items-center gap-2 font-medium"><Mark size={22} /> Lien</Link>
        <button type="button" className="btn btn-secondary btn-sm" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? "Close" : "Menu"}
        </button>
      </header>
      {open ? (
        <div className="fixed inset-x-0 top-12 bottom-0 z-30 space-y-6 overflow-auto bg-[var(--paper-sage)] p-4 lg:hidden">
          <NavLinks onNavigate={() => setOpen(false)} />
          <AccountBox />
        </div>
      ) : null}

      <aside className="fixed inset-y-0 left-0 hidden w-[248px] flex-col justify-between overflow-y-auto p-3 lg:flex">
        <div className="space-y-5">
          <Link href="/" className="flex items-center gap-2 px-3 pt-2 text-[17px] font-medium"><Mark size={24} /> Lien</Link>
          <p className="px-3 text-[13px] muted">
            NEAR {NETWORK}. {isTestnet ? "Test money only." : "Real money."}
          </p>
          <NavLinks />
        </div>
        <div className="px-3 pb-3"><AccountBox /></div>
      </aside>

      <main className="px-4 pt-3 pb-16 lg:ml-[248px] lg:px-6 lg:pt-8">
        <div className="mx-auto max-w-[1240px]">{children}</div>
      </main>
    </div>
  );
}
