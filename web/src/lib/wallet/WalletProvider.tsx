"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { NearConnector } from "@hot-labs/near-connect";
import { isTestnet, NETWORK, deployment } from "../config";
import { faucet, type TxRequest } from "../near/actions";
import { readOutcome, type RawOutcome, type TxResult } from "../near/outcome";
import { isRegistered } from "../near/rpc";
import { createGuest, forgetGuest, loadGuest, sendAsGuest, type Guest } from "./guest";

export type WalletKind = "wallet" | "guest";

type WalletState = {
  account: string | null;
  kind: WalletKind | null;
  ready: boolean;
  connect: () => Promise<void>;
  startGuest: () => Promise<void>;
  disconnect: () => Promise<void>;
  /**
   * Signs and sends. `requiredOn` names the contract that must not have failed:
   * a token transfer reports success even if its receiver refused the money.
   */
  send: (request: TxRequest, requiredOn?: string) => Promise<TxResult>;
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
        try {
          const instance = await getConnector();
          const { accounts } = await instance.getConnectedWallet();
          if (!cancelled && accounts[0]) {
            setAccount(accounts[0].accountId);
            setKind("wallet");
          }
        } catch {
          // Nobody is connected, which is the normal first visit.
        }
      }
      if (!cancelled) setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [getConnector]);

  const send = useCallback<WalletState["send"]>(async (request, requiredOn) => {
    if (guest.current) {
      return readOutcome(await sendAsGuest(guest.current, request), requiredOn);
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
      setAccount(created.accountId);
      setKind("guest");
      // Guests start with test funds so they can use every part of the product.
      const registered = await isRegistered(created.accountId);
      await sendAsGuest(created, faucet(created.accountId, 500n * 10n ** BigInt(deployment.tokenDecimals), { register: !registered }));
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
