// The guarded signer. The agent does not sign whatever the MCP server hands back: each
// prepared transaction is compared with what the agent decided to do, against values
// pinned in its own policy file, and refused on any difference. A compromised or
// confused server (or a prompt-injected caller) cannot turn a lend into a payment to
// someone else.

import type { Policy } from "./policy";

export type PreparedAction = { type: string; method_name: string; args: Record<string, any>; gas: string; deposit: string };
export type Prepared = { signer_id: string; receiver_id: string; actions: PreparedAction[] };

/** What the agent meant to do. */
export type Intent =
  | { kind: "pay"; business: string; units: bigint; msg: { action: "fund"; loan_id: number } | { action: "job"; input: string } | { action: "repay" } }
  | { kind: "call"; business: string; method: "claim" | "foreclose"; loanId?: number }
  /** A counter-offer: 1 unit of the token to the business's operator, the terms in the memo. */
  | { kind: "counter"; business: string; operator: string; memo: string };

const TOKEN_REGISTRATION = "1250000000000000000000";
const MAX_GAS = 300_000_000_000_000n;

/** Every reason not to sign; empty means the transaction is exactly what was intended. */
export function vet(tx: Prepared, intent: Intent, me: string, policy: Policy): string[] {
  const problems: string[] = [];
  if (tx.signer_id !== me) problems.push(`signer is ${tx.signer_id}, not this agent (${me})`);
  if (!intent.business.endsWith(`.${policy.registry}`)) problems.push(`${intent.business} is not under the pinned registry ${policy.registry}`);
  if (!Array.isArray(tx.actions) || tx.actions.length === 0) return [...problems, "no actions"];
  for (const a of tx.actions) {
    if (a.type !== "FunctionCall") problems.push(`action ${a.type} is not a function call`);
    try {
      if (BigInt(a.gas) > MAX_GAS) problems.push(`gas ${a.gas} above 300 Tgas`);
    } catch {
      problems.push(`gas ${a.gas} is not a number`);
    }
  }

  if (intent.kind === "pay") {
    if (tx.receiver_id !== policy.token) problems.push(`receiver is ${tx.receiver_id}, not the pinned token ${policy.token}`);
    const transfers = tx.actions.filter((a) => a.method_name === "ft_transfer_call");
    const others = tx.actions.filter((a) => a.method_name !== "ft_transfer_call");
    if (transfers.length !== 1) problems.push(`expected exactly one ft_transfer_call, found ${transfers.length}`);
    for (const o of others) {
      const okRegistration = o.method_name === "storage_deposit" && o.args?.account_id === me && o.deposit === TOKEN_REGISTRATION;
      if (!okRegistration) problems.push(`unexpected call ${o.method_name}(${JSON.stringify(o.args)}) with deposit ${o.deposit}`);
    }
    const t = transfers[0];
    if (t) {
      if (t.deposit !== "1") problems.push(`ft_transfer_call deposit is ${t.deposit} yocto, not 1`);
      if (t.args?.receiver_id !== intent.business) problems.push(`pays ${t.args?.receiver_id}, not ${intent.business}`);
      if (String(t.args?.amount) !== intent.units.toString()) problems.push(`amount is ${t.args?.amount}, not ${intent.units}`);
      let msg: unknown = null;
      try {
        msg = JSON.parse(String(t.args?.msg));
      } catch {
        problems.push("transfer message is not JSON");
      }
      if (JSON.stringify(msg) !== JSON.stringify(intent.msg)) problems.push(`transfer message is ${t.args?.msg}, not ${JSON.stringify(intent.msg)}`);
      const extra = Object.keys(t.args ?? {}).filter((k) => !["receiver_id", "amount", "msg", "memo"].includes(k));
      if (extra.length) problems.push(`unexpected transfer arguments: ${extra.join(", ")}`);
    }
  } else if (intent.kind === "counter") {
    if (tx.receiver_id !== policy.token) problems.push(`receiver is ${tx.receiver_id}, not the pinned token ${policy.token}`);
    if (tx.actions.length !== 1) problems.push(`expected one call, found ${tx.actions.length}`);
    const a = tx.actions[0]!;
    if (a.method_name !== "ft_transfer") problems.push(`method is ${a.method_name}, not ft_transfer`);
    if (a.deposit !== "1") problems.push(`deposit is ${a.deposit} yocto, not 1`);
    if (a.args?.receiver_id !== intent.operator) problems.push(`sends to ${a.args?.receiver_id}, not the operator ${intent.operator}`);
    if (String(a.args?.amount) !== "1") problems.push(`amount is ${a.args?.amount}, not 1 unit`);
    if (a.args?.memo !== intent.memo) problems.push("memo differs from the counter decided");
  } else {
    if (tx.receiver_id !== intent.business) problems.push(`receiver is ${tx.receiver_id}, not ${intent.business}`);
    if (tx.actions.length !== 1) problems.push(`expected one call, found ${tx.actions.length}`);
    const a = tx.actions[0]!;
    if (a.method_name !== intent.method) problems.push(`method is ${a.method_name}, not ${intent.method}`);
    if (a.deposit !== "0") problems.push(`deposit is ${a.deposit}, not 0`);
    if (intent.method === "claim" && a.args?.loan_id !== intent.loanId) problems.push(`loan_id is ${a.args?.loan_id}, not ${intent.loanId}`);
  }
  return problems;
}
