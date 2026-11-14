// The people around the agent-to-agent negotiation demo. The two agents (agents/lender,
// agents/borrower) decide and sign for themselves; this script plays the humans:
//
//   npm run negotiation-demo colend     a human co-lender completes the borrower's loan, so it
//                                       activates (the lender agent never takes over half a loan)
//   npm run negotiation-demo customer   a customer buys CHECKS (default 2) checks from the
//                                       borrower's business: each sale pays lenders first, the
//                                       operator its share, and the business's data vendor
//                                       0.02 tUSD out of working capital
//
// BUSINESS defaults to the business in agents/borrower/agent.json. HUMAN (default
// lien-f4-3863.testnet) signs; its key comes from ~/.near-credentials/testnet.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { account, explorerTx, loadDeployment, network, pay, ROOT, view } from "./lib.js";

const net = network();
if (net !== "testnet") throw new Error("The negotiation demo runs on testnet only");
const d = loadDeployment(net);
const HUMAN = process.env.HUMAN ?? "lien-f4-3863.testnet";
const BUSINESS = process.env.BUSINESS ?? (JSON.parse(readFileSync(join(ROOT, "agents/borrower/agent.json"), "utf8")) as { business: string }).business;

type Agent = { name: string; service: { price: string }; current_loan: null | { loan: { id: number; status: string; funded: string; terms: { principal: string } } } & Record<string, any> };

async function loan() {
  const a = await view<Agent>(BUSINESS, "get_agent", {}, net);
  const l = a.current_loan as any;
  if (!l) throw new Error(`${BUSINESS} has no open loan`);
  // LoanView flattens the loan's fields.
  return { a, id: l.id as number, status: l.status as string, funded: BigInt(l.funded), principal: BigInt(l.terms.principal) };
}

async function colend() {
  const { id, status, funded, principal } = await loan();
  if (status !== "Funding") throw new Error(`loan ${id} is ${status}, not raising`);
  const rest = principal - funded;
  const sent = await pay(account(HUMAN, net), d.token, BUSINESS, rest, { action: "fund", loan_id: id });
  console.log(`a human co-lender (${HUMAN}) funds the last ${Number(rest) / 1e6} tUSD of loan ${id}: ${explorerTx(sent.tx, net)}`);
}

async function customer() {
  const { a } = await loan();
  const n = Number(process.env.CHECKS ?? 2);
  const targets = ["outlayer.testnet", "lien-13569.testnet", "usd.lien-13569.testnet"];
  for (let i = 0; i < n; i++) {
    const sent = await pay(account(HUMAN, net), d.token, BUSINESS, BigInt(a.service.price), { action: "job", input: `check ${targets[i % targets.length]}` });
    console.log(`a customer (${HUMAN}) buys a check from ${a.name} for ${Number(a.service.price) / 1e6} tUSD: ${explorerTx(sent.tx, net)}`);
  }
}

const step = process.argv[2];
if (step === "colend") await colend();
else if (step === "customer") await customer();
else throw new Error("Usage: npm run negotiation-demo colend | customer");
