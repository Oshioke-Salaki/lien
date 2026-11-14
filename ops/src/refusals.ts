// Tries to rob a live business during its loan, on purpose, and records each refusal on chain.
// Every attempt is a real signed transaction from a real account; each one fails inside the
// contract, and the transaction hash proves it.
//
//   LIEN_NETWORK=testnet BUSINESS=sentinel.v1.lien-13569.testnet OWNER=lien-f1-3833.testnet STRANGER=lien-f4-3863.testnet npm run refusals

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { actions } from "near-api-js";
import { account, explorerTx, network, ROOT, view } from "./lib.js";

const net = network();
const business = process.env.BUSINESS ?? "sentinel.v1.lien-13569.testnet";
const ownerId = process.env.OWNER ?? "lien-f1-3833.testnet";
const strangerId = process.env.STRANGER ?? "lien-f4-3863.testnet";

const agent = await view<any>(business, "get_agent", {}, net);
if (!agent.current_loan) throw new Error(`${business} has no open loan; the refusals only mean something during one`);
const evil = { ...agent.service, wasm: { ...agent.service.wasm, url: "https://example.com/evil.wasm", hash: "0".repeat(64) } };

async function attempt(who: string, what: string, method: string, args: object) {
  const signer = account(who, net);
  const outcome = await signer.signAndSendTransaction({
    receiverId: business,
    actions: [actions.functionCall(method, args as Record<string, unknown>, 30_000_000_000_000n, 0n)],
    waitUntil: "FINAL",
    throwOnFailure: false,
  });
  const failure = (outcome.status as { Failure?: any }).Failure;
  const reason = failure ? JSON.stringify(failure).match(/Smart contract panicked: ([^"\\]+)/)?.[1] ?? JSON.stringify(failure).slice(0, 160) : null;
  const row = { what, by: who, method, refused: Boolean(failure), reason, tx: outcome.transaction.hash, link: explorerTx(outcome.transaction.hash, net) };
  console.log(`${row.refused ? "REFUSED" : "!! ACCEPTED"}  ${what}\n  ${reason}\n  ${row.link}`);
  return row;
}

const rows = [
  await attempt(ownerId, "The owner tries to withdraw the business's money during the loan", "withdraw_opex", { amount: "1000000" }),
  await attempt(ownerId, "The owner tries to swap in different code during the loan, without lenders", "update_service", { service: evil }),
  await attempt(strangerId, "A stranger tries to take the business's money", "withdraw_opex", { amount: "1000000" }),
];
const out = { business, network: net, at: new Date().toISOString(), loan: agent.current_loan.id, attempts: rows };
writeFileSync(join(ROOT, `docs/evidence/refusals-${net}.json`), JSON.stringify(out, null, 2) + "\n");
if (rows.some((r) => !r.refused)) process.exit(1);
console.log("\nAll refused. Saved docs/evidence/refusals-" + net + ".json");
