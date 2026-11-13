"use client";

import { useCallback } from "react";
import { useTx } from "@/components/Tx";
import { remember } from "@/lib/mine";
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
      const result = await run({ summary, prepare }, { requiredOn: agent, done, pending });
      // Lent to, bid on or bought from: "Your positions" reads this business first from now on.
      if (result?.ok) remember(account, agent);
      return result;
    },
    [account, agent, run],
  );
}
