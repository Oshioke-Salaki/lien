// Every state change the app can make, as transaction descriptions. They are data
// so one wallet layer can sign them and tests can check them without a chain.

import { deployment, isTestnet } from "../config";
import type { LoanTerms, Service } from "./types";

export type FunctionCall = {
  methodName: string;
  args: Record<string, unknown>;
  gasTera: number;
  deposit: string;
};

export type TxRequest = { receiverId: string; calls: FunctionCall[]; summary: string };

const YOCTO_ONE = "1";
/** Storage for one account on the token. */
export const TOKEN_REGISTRATION = "1250000000000000000000";

const call = (methodName: string, args: Record<string, unknown> = {}, deposit = "0", gasTera = 300): FunctionCall => ({
  methodName,
  args,
  gasTera,
  deposit,
});

export type TransferMsg =
  | { action: "fund"; loan_id: number }
  | { action: "job"; input: string }
  | { action: "repay" }
  | { action: "bid" }
  | { action: "topup" };

/**
 * Pays the agent in tokens. Token registration, when missing, goes in the same
 * transaction, so a first-time user signs once.
 */
export function payAgent(
  agent: string,
  amount: bigint,
  msg: TransferMsg,
  summary: string,
  { register, account }: { register: boolean; account: string },
): TxRequest {
  const calls: FunctionCall[] = [];
  if (register) calls.push(call("storage_deposit", { account_id: account }, TOKEN_REGISTRATION, 30));
  calls.push(
    call(
      "ft_transfer_call",
      { receiver_id: agent, amount: amount.toString(), msg: JSON.stringify(msg) },
      YOCTO_ONE,
      register ? 270 : 300,
    ),
  );
  return { receiverId: deployment.token, calls, summary };
}

export function faucet(account: string, amount: bigint, { register }: { register: boolean }): TxRequest {
  if (!isTestnet) throw new Error("The faucet only exists on testnet");
  const calls: FunctionCall[] = [];
  if (register) calls.push(call("storage_deposit", { account_id: account }, TOKEN_REGISTRATION, 30));
  calls.push(call("faucet", { account_id: account, amount: amount.toString() }, "0", 30));
  return { receiverId: deployment.token, calls, summary: "Get test funds" };
}

const onAgent = (agent: string, summary: string, c: FunctionCall): TxRequest => ({ receiverId: agent, calls: [c], summary });

export const createOffer = (agent: string, terms: LoanTerms) =>
  onAgent(agent, "Open a loan offer", call("create_offer", { terms }));
export const cancelOffer = (agent: string) => onAgent(agent, "Cancel the offer", call("cancel_offer"));
export const foreclose = (agent: string) => onAgent(agent, "Foreclose", call("foreclose"));
export const settleAuction = (agent: string) => onAgent(agent, "Settle the sale", call("settle_auction"));
export const claim = (agent: string, loanId: number) => onAgent(agent, "Claim repayments", call("claim", { loan_id: loanId }));
export const withdrawCredit = (agent: string, account: string) =>
  onAgent(agent, "Collect what you are owed", call("withdraw", { account_id: account }));
export const withdrawOperator = (agent: string) => onAgent(agent, "Withdraw your share", call("withdraw_operator", { amount: null }));
export const withdrawOpex = (agent: string, amount: bigint) =>
  onAgent(agent, "Withdraw working capital", call("withdraw_opex", { amount: amount.toString() }));
export const repayFromOpex = (agent: string, amount: bigint) =>
  onAgent(agent, "Repay from working capital", call("repay_from_opex", { amount: amount.toString() }));
export const updateService = (agent: string, service: Service) =>
  onAgent(agent, "Update the service", call("update_service", { service }));
export const proposeChange = (agent: string, service: Service) =>
  onAgent(agent, "Propose a change to lenders", call("propose_change", { service }));
export const approveChange = (agent: string, proposalId: number) =>
  onAgent(agent, "Approve the change", call("approve_change", { proposal_id: proposalId }));
export const transferNote = (agent: string, loanId: number, to: string) =>
  onAgent(agent, "Transfer your note", call("transfer_note", { loan_id: loanId, to }, YOCTO_ONE));
export const fundTank = (agent: string, yocto: string) => onAgent(agent, "Top up compute funds", call("fund_tank", {}, yocto, 30));
export const expireJob = (agent: string, jobId: number) => onAgent(agent, "Refund the stuck job", call("expire_job", { job_id: jobId }));
export const forward = (collector: string) => onAgent(collector, "Forward income", call("forward"));

export const createBusiness = (args: {
  label: string;
  name: string;
  description: string;
  sourceUrl: string;
  service: Service;
  depositYocto: string;
}): TxRequest => ({
  receiverId: deployment.registry,
  summary: `Create ${args.name}`,
  calls: [
    call(
      "create_agent",
      {
        label: args.label,
        name: args.name,
        description: args.description,
        source_url: args.sourceUrl,
        service: args.service,
      },
      args.depositYocto,
    ),
  ],
});
