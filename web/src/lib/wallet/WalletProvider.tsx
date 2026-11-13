"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { NearConnector } from "@hot-labs/near-connect";
import { isTestnet, NETWORK, deployment } from "../config";
import { faucet, type TxRequest } from "../near/actions";
import { isFeeShortfall, readOutcome, type RawOutcome, type TxResult } from "../near/outcome";
import { isRegistered } from "../near/rpc";
import { backupText, createGuest, forgetGuest, loadGuest, restoreGuest, sendAsGuest, topUpGuest, type Guest } from "./guest";

const WALLET_RESTORE_MS = 2_500;

export type WalletKind = "wallet" | "guest";

type WalletState = {
  account: string | null;
  kind: WalletKind | null;
  ready: boolean;
  connect: () => Promise<void>;
  startGuest: () => Promise<void>;
  disconnect: () => Promise<void>;
  /** The backup line for a free test account, or null for a wallet. */
  backup: () => string | null;
  /** Restores a free test account from its backup line, after checking it on the network. */
  restore: (text: string) => Promise<void>;
  /**
   * Signs and sends. `requiredOn` names the contract that must not have failed:
   * a token transfer reports success even if its receiver refused the money.
   */
  send: (request: TxRequest, requiredOn?: string, onStatus?: (text: string) => void, onHash?: (hash: string) => void) => Promise<TxResult>;
};

const WalletContext = createContext<WalletState | null>(null);

export function WalletProvider({ children }: { children: ReactNode }) {
  const [account, setAccount] = useState<string | null>(null);
  const [kind, setKind] = useState<WalletKind | null>(null);
  const [ready, setReady] = useState(false);
  const connector = useRef<Promise<NearConnector> | null>(null);
  const guest = useRef<Guest | null>(null);

  const getConnector = useCallback(() => {
    connector.current ??= import("@hot-labs/near-connect").then(({ NearConnector }) => {
      const instance = new NearConnector({ network: NETWORK, footerBranding: null });
      instance.on("wallet:signIn", ({ accounts }) => {
        guest.current = null;
        setAccount(accounts[0]?.accountId ?? null);
        setKind("wallet");
      });
      instance.on("wallet:signOut", () => {
        setAccount(null);
        setKind(null);
      });
      return instance;
    });
    return connector.current;
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const saved = loadGuest();
      if (saved) {
        guest.current = saved;
        if (!cancelled) {
          setAccount(saved.accountId);
          setKind("guest");
        }
      } else {
        // The wallet list loads over the network. A slow connection must not hold
        // up the page, so show it as signed out and restore the wallet if it arrives.
        const giveUp = setTimeout(() => { if (!cancelled) setReady(true); }, WALLET_RESTORE_MS);
        try {
          const instance = await getConnector();
          const { accounts } = await instance.getConnectedWallet();
          if (!cancelled && accounts[0]) {
            setAccount(accounts[0].accountId);
            setKind("wallet");
          }
        } catch {
          // Nobody is connected, which is the normal first visit.
        } finally {
          clearTimeout(giveUp);
        }
      }
      if (!cancelled) setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [getConnector]);

  const send = useCallback<WalletState["send"]>(async (request, requiredOn, onStatus, onHash) => {
    const current = guest.current;
    if (current) {
      // A free account that has spent its NEAR on fees gets a little more from the
      // sponsor, and the action is tried once more, instead of ending on an error.
      const attempt = async () => readOutcome(await sendAsGuest(current, request, onHash), requiredOn);
      let result: TxResult | null = null;
      let thrown: unknown = null;
      try { result = await attempt(); } catch (error) { thrown = error; }
      const shortfall = thrown ? isFeeShortfall(thrown instanceof Error ? thrown.message : String(thrown)) : !result!.ok && isFeeShortfall(result!.error);
      if (!shortfall) {
        if (thrown) throw thrown;
        return result!;
      }
      onStatus?.("Adding a little NEAR to your test account for network fees, then trying again…");
      const added = await topUpGuest(current.accountId, "fees");
      if (added === "0" && thrown) throw thrown;
      return attempt();
    }
    const instance = await getConnector();
    const wallet = await instance.wallet();
    const outcome = await wallet.signAndSendTransaction({
      receiverId: request.receiverId,
      actions: request.calls.map((call) => ({
        type: "FunctionCall" as const,
        params: {
          methodName: call.methodName,
          args: call.args,
          gas: (BigInt(call.gasTera) * 10n ** 12n).toString(),
          deposit: call.deposit,
        },
      })),
    });
    return readOutcome(outcome as unknown as RawOutcome, requiredOn);
  }, [getConnector]);

  const value = useMemo<WalletState>(() => ({
    account,
    kind,
    ready,
    send,
    connect: async () => {
      const instance = await getConnector();
      await instance.connect();
    },
    startGuest: async () => {
      if (!isTestnet) throw new Error("Guest accounts only exist on testnet");
      const created = await createGuest();
      guest.current = created;
      // Guests start with test funds, and only appear signed in once they have them.
      const registered = await isRegistered(created.accountId);
      await sendAsGuest(created, faucet(created.accountId, 500n * 10n ** BigInt(deployment.tokenDecimals), { register: !registered }));
      setAccount(created.accountId);
      setKind("guest");
    },
    backup: () => (guest.current ? backupText(guest.current) : null),
    restore: async (text: string) => {
      const restored = await restoreGuest(text);
      guest.current = restored;
      setAccount(restored.accountId);
      setKind("guest");
    },
    disconnect: async () => {
      if (guest.current) {
        guest.current = null;
        forgetGuest();
      } else {
        const instance = await getConnector();
        await instance.disconnect().catch(() => undefined);
      }
      setAccount(null);
      setKind(null);
    },
  }), [account, kind, ready, send, getConnector]);

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet(): WalletState {
  const value = useContext(WalletContext);
  if (!value) throw new Error("useWallet needs a WalletProvider");
  return value;
}
