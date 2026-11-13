import { deployment } from "./config";
import * as tx from "./near/actions";
import { getBusiness, getJobs, isRegistered, listBusinesses } from "./near/rpc";
import type { Business } from "./near/types";

// Lien as tools for AI agents: a Model Context Protocol server over Streamable HTTP
// (stateless JSON-RPC on POST). Read tools return what the chain says; action tools
// return unsigned transactions for the agent to sign with its own key. This server
// never holds a key and never sends a transaction.



const PROTOCOL = "2025-06-18";
export const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "content-type, mcp-protocol-version, mcp-session-id", "access-control-allow-methods": "POST, GET, OPTIONS" };
const ACCOUNT = /^(?=.{2,64}$)(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;
const UNITS = 10n ** BigInt(deployment.tokenDecimals);

type Json = Record<string, unknown>;
export class InputError extends Error {}

export function amount(value: unknown, name: string): bigint {
  const text = String(value ?? "").trim();
  if (!/^\d+(\.\d{1,6})?$/.test(text)) throw new InputError(`${name} must be a decimal amount of ${deployment.tokenSymbol}, like "12.5"`);
  const [whole, frac = ""] = text.split(".");
  const units = BigInt(whole) * UNITS + BigInt(frac.padEnd(deployment.tokenDecimals, "0").slice(0, deployment.tokenDecimals));
  if (units <= 0n) throw new InputError(`${name} must be more than zero`);
  return units;
}
export function account(value: unknown, name: string): string {
  const id = String(value ?? "").trim().toLowerCase();
  if (!ACCOUNT.test(id)) throw new InputError(`${name} must be a NEAR account id`);
  return id;
}
export function business(value: unknown): string {
  const id = account(value, "business");
  return id.includes(".") ? id : `${id}.${deployment.registry}`;
}
const tokens = (units: string | bigint) => {
  const v = BigInt(units);
  const frac = (v % UNITS).toString().padStart(deployment.tokenDecimals, "0").replace(/0+$/, "");
  return `${v / UNITS}${frac ? `.${frac}` : ""} ${deployment.tokenSymbol}`;
};

function summary(b: Business) {
  const loan = b.current_loan;
  return {
    id: b.id,
    name: b.name,
    sells: b.description,
    job_price: tokens(String((b.service as { price?: string })?.price ?? "0")),
    jobs_done: b.stats.jobs_done,
    unique_payers: b.stats.unique_payers,
    loan: loan
      ? {
          id: loan.id,
          state: loan.is_behind && loan.status === "Active" ? "Behind" : loan.status,
          principal: tokens(loan.terms.principal),
          funded: tokens(loan.funded),
          repaid: tokens(loan.repaid),
          outstanding: tokens(loan.outstanding),
          lenders_get: `${loan.terms.lender_bps / 100}% of every sale`,
          operator_gets: `${loan.terms.operator_bps / 100}% of every sale`,
          min_payment: `${tokens(loan.terms.min_payment_per_window)} every ${Math.round(loan.terms.window_secs / 86400 * 10) / 10} days`,
          foreclosable_at: loan.foreclosable_at ? new Date(loan.foreclosable_at * 1000).toISOString() : null,
          auction: loan.status === "Foreclosed" ? { high_bid: tokens(loan.auction.high_bid), min_next_bid: tokens(loan.min_next_bid ?? "0"), ends_at: loan.auction.ends_at ? new Date(loan.auction.ends_at * 1000).toISOString() : null } : null,
        }
      : null,
    page: `https://lien-five.vercel.app/b/${b.id}`,
  };
}

/** A transaction for the agent to sign, in the shape near-api-js and every NEAR wallet take. */
function unsigned(request: tx.TxRequest, signer: string, note: string) {
  return {
    note,
    signer_id: signer,
    receiver_id: request.receiverId,
    actions: request.calls.map((c) => ({ type: "FunctionCall", method_name: c.methodName, args: c.args, gas: `${c.gasTera}000000000000`, deposit: c.deposit })),
  };
}

async function pay(agent: string, from: string, units: bigint, msg: tx.TransferMsg, summaryText: string, note: string) {
  const register = !(await isRegistered(from));
  return unsigned(tx.payAgent(agent, units, msg, summaryText, { register, account: from }), from, note);
}

export const TOOLS = [
  { name: "list_businesses", description: "Every AI business on Lien with its loan state: raising, paying, behind, foreclosed or repaid. Start here.", inputSchema: { type: "object", properties: {} } },
  { name: "get_business", description: "One business: what it sells, its stats, its current loan and auction, and its recent jobs.", inputSchema: { type: "object", properties: { business: { type: "string", description: "Account id, or the short name like 'sentinel'" } }, required: ["business"] } },
  { name: "prepare_lend", description: "Unsigned transaction that funds the business's open loan. The lender receives a note and a share of every sale.", inputSchema: { type: "object", properties: { business: { type: "string" }, lender: { type: "string", description: "The account that signs and pays" }, amount: { type: "string", description: "Decimal tUSD, like '25'" } }, required: ["business", "lender", "amount"] } },
  { name: "prepare_buy_job", description: "Unsigned transaction that buys one job (for Sentinel: a risk check of a NEAR account). The price is escrowed and refunded if the run fails.", inputSchema: { type: "object", properties: { business: { type: "string" }, buyer: { type: "string" }, input: { type: "string", description: "The job input, e.g. the account to check" } }, required: ["business", "buyer", "input"] } },
  { name: "prepare_repay", description: "Unsigned transaction that pays down the business's debt. Anyone may pay; anything above the debt comes back.", inputSchema: { type: "object", properties: { business: { type: "string" }, payer: { type: "string" }, amount: { type: "string" } }, required: ["business", "payer", "amount"] } },
  { name: "prepare_bid", description: "Unsigned transaction that bids on a foreclosed business. Bids are escrowed; an outbid bidder is refunded at once.", inputSchema: { type: "object", properties: { business: { type: "string" }, bidder: { type: "string" }, amount: { type: "string" } }, required: ["business", "bidder", "amount"] } },
  { name: "prepare_foreclose", description: "Unsigned transaction that forecloses a business past its grace period. Open to anyone; refused while it is current.", inputSchema: { type: "object", properties: { business: { type: "string" }, signer: { type: "string" } }, required: ["business", "signer"] } },
  { name: "prepare_claim", description: "Unsigned transaction that collects a lender's repayments on a loan.", inputSchema: { type: "object", properties: { business: { type: "string" }, lender: { type: "string" }, loan_id: { type: "number" } }, required: ["business", "lender", "loan_id"] } },
];

async function callTool(name: string, args: Json): Promise<unknown> {
  switch (name) {
    case "list_businesses":
      return { network: deployment.network, token: deployment.token, businesses: (await listBusinesses()).map(summary) };
    case "get_business": {
      const id = business(args.business);
      const [b, jobs] = await Promise.all([getBusiness(id), getJobs(id, 5).catch(() => [])]);
      return { ...summary(b), recent_jobs: jobs.map((j) => ({ id: j.id, input: j.input, status: j.status, paid: tokens(j.paid) })) };
    }
    case "prepare_lend": {
      const id = business(args.business), from = account(args.lender, "lender"), units = amount(args.amount, "amount");
      const b = await getBusiness(id);
      if (!b.current_loan || b.current_loan.status !== "Funding") throw new InputError(`${b.name} is not raising a loan right now`);
      const room = BigInt(b.current_loan.terms.principal) - BigInt(b.current_loan.funded);
      if (units > room) throw new InputError(`Only ${tokens(room)} is left to raise`);
      return pay(id, from, units, { action: "fund", loan_id: b.current_loan.id }, `Lend to ${b.name}`, "Funds move to the business only once the loan is full; until then a lender can be refunded if it lapses.");
    }
    case "prepare_buy_job": {
      const id = business(args.business), from = account(args.buyer, "buyer");
      const input = String(args.input ?? "").trim();
      if (!input || input.length > 2000) throw new InputError("input must be 1 to 2000 characters");
      const b = await getBusiness(id);
      const price = BigInt(String((b.service as { price?: string })?.price ?? "0"));
      if (price <= 0n) throw new InputError(`${b.name} has no job price set`);
      return pay(id, from, price, { action: "job", input }, `Buy a job from ${b.name}`, `Pays ${tokens(price)}. The result is written on chain; read it with get_business.`);
    }
    case "prepare_repay": {
      const id = business(args.business);
      return pay(id, account(args.payer, "payer"), amount(args.amount, "amount"), { action: "repay" }, "Pay down the debt", "Counts towards the schedule at once.");
    }
    case "prepare_bid": {
      const id = business(args.business), units = amount(args.amount, "amount");
      const b = await getBusiness(id);
      const loan = b.current_loan;
      if (!loan || loan.status !== "Foreclosed") throw new InputError(`${b.name} is not in foreclosure`);
      if (units < BigInt(loan.min_next_bid ?? "0")) throw new InputError(`The minimum bid is ${tokens(loan.min_next_bid ?? "0")}`);
      return pay(id, account(args.bidder, "bidder"), units, { action: "bid" }, `Bid on ${b.name}`, "The highest bid at the end buys control of the business.");
    }
    case "prepare_foreclose": {
      const id = business(args.business);
      const b = await getBusiness(id);
      const at = b.current_loan?.foreclosable_at;
      if (!b.current_loan || b.current_loan.status !== "Active" || !at || Date.now() / 1000 < at) throw new InputError(`${b.name} cannot be foreclosed now`);
      return unsigned(tx.foreclose(id), account(args.signer, "signer"), "Open to anyone once the grace period has passed.");
    }
    case "prepare_claim": {
      const id = business(args.business), loanId = Number(args.loan_id);
      if (!Number.isInteger(loanId) || loanId < 0) throw new InputError("loan_id must be a loan number");
      return unsigned(tx.claim(id, loanId), account(args.lender, "lender"), "Sends whatever your note has earned so far.");
    }
    default:
      throw new InputError(`Unknown tool: ${name}`);
  }
}

export type RpcRequest = { jsonrpc?: string; id?: string | number | null; method?: string; params?: Json };

export async function handle(msg: RpcRequest): Promise<Json | null> {
  const reply = (result: unknown) => ({ jsonrpc: "2.0", id: msg.id ?? null, result });
  const fail = (code: number, message: string) => ({ jsonrpc: "2.0", id: msg.id ?? null, error: { code, message } });
  if (msg.id === undefined) return null; // a notification needs no answer
  switch (msg.method) {
    case "initialize":
      return reply({
        protocolVersion: PROTOCOL,
        capabilities: { tools: {} },
        serverInfo: { name: "lien", title: "Lien", version: "1.0.0" },
        instructions: "Lien lends to AI businesses on NEAR. Read the market with list_businesses, then prepare a transaction and sign it with your own key. Testnet, test dollars (tUSD).",
      });
    case "ping":
      return reply({});
    case "tools/list":
      return reply({ tools: TOOLS });
    case "tools/call": {
      const name = String(msg.params?.name ?? "");
      try {
        const out = await callTool(name, (msg.params?.arguments as Json) ?? {});
        return reply({ content: [{ type: "text", text: JSON.stringify(out, null, 2) }], structuredContent: out, isError: false });
      } catch (error) {
        const text = error instanceof InputError ? error.message : "The network could not be reached. Try again.";
        return reply({ content: [{ type: "text", text }], isError: true });
      }
    }
    default:
      return fail(-32601, `Method not found: ${msg.method}`);
  }
}
