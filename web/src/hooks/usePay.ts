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
    async (amount: bigint, msg: TransferMsg, summary: string, done: string, pending?: string) => {
      if (!account) return null;
      const prepare = async () => payAgent(agent, amount, msg, summary, { register: !(await isRegistered(account)), account });
      return run({ summary, prepare }, { requiredOn: agent, done, pending });
    },
    [account, agent, run],
  );
}
