"use client";

import { useCallback } from "react";
import { useTx } from "@/components/Tx";
import { payAgent, type TransferMsg } from "@/lib/near/actions";
import { isRegistered } from "@/lib/near/rpc";
import { useWallet } from "@/lib/wallet/WalletProvider";

/** Pays a business, registering the sender with the token first if needed. */
export function usePay(agent: string) {
  const { account } = useWallet();
  const { run } = useTx();
  return useCallback(
    async (amount: bigint, msg: TransferMsg, summary: string, done: string) => {
      if (!account) return null;
      const registered = await isRegistered(account);
      return run(payAgent(agent, amount, msg, summary, { register: !registered, account }), { requiredOn: agent, done });
    },
    [account, agent, run],
  );
}
