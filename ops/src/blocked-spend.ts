// A compromised build tries to pay someone outside the business's spend policy, on chain.
//
// Moves a business with no open loan to a build that names an unapproved vendor (published with
// `NO_SAVE=1 VENDOR=attacker.testnet npm run publish-agent`), buys one check, shows the contract
// skipped the payment and counted it in spends_blocked, then puts the business back on its
// previous build. Records every transaction in docs/evidence/blocked-spend-testnet.json.
//
//   LIEN_NETWORK=testnet BUSINESS=beacon-repaid-7978.v1.lien-13569.testnet OPERATOR=lien-f4-3863.testnet \
//     BAD_URL=https://test.fastfs.io/.../<hash>.wasm BAD_HASH=<hash> BUYER=lien-f4-3863.testnet npm run blocked-spend

import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { account, call, explorerTx, network, ROOT, view } from "./lib.js";

const net = network();
const { BUSINESS: business, OPERATOR: operatorId, BAD_URL: badUrl, BAD_HASH: badHash, BUYER: buyer } = process.env;
if (!business || !operatorId || !badUrl || !badHash || !buyer) throw new Error("Set BUSINESS, OPERATOR, BAD_URL, BAD_HASH and BUYER");

const before = await view<any>(business, "get_agent", {}, net);
if (before.current_loan) throw new Error(`${business} has an open loan; its build cannot change outside governance`);
const original = before.service;
const operator = account(operatorId, net);
const steps: Record<string, string> = {};

const bad = { ...original, wasm: { ...original.wasm, url: badUrl, hash: badHash }, secrets_profile: null };
steps.switch_to_compromised = (await call(operator, business, "update_service", { service: bad }, { tgas: 30n })).tx;
console.log(`switched ${business} to the compromised build ${badHash.slice(0, 12)}…: ${explorerTx(steps.switch_to_compromised, net)}`);

const blockedBefore = Number(before.stats?.spends_blocked ?? 0);
let out = "";
try {
  out = execFileSync("npx", ["tsx", "src/heartbeat.ts"], { env: { ...process.env, BUSINESS: business, BUYER: buyer, LIEN_NETWORK: net }, encoding: "utf8", timeout: 400_000 });
} finally {
  steps.restore = (await call(operator, business, "update_service", { service: original }, { tgas: 30n })).tx;
  console.log(`restored ${business} to ${original.wasm.hash.slice(0, 12)}…: ${explorerTx(steps.restore, net)}`);
}
const bought = out.match(/txns\/([1-9A-HJ-NP-Za-km-z]{43,44})/)?.[1];
if (bought) steps.buy_check = bought;

const after = await view<any>(business, "get_agent", {}, net);
const blockedAfter = Number(after.stats?.spends_blocked ?? 0);
const record = {
  business, network: net, at: new Date().toISOString(),
  compromised_build: { hash: badHash, url: badUrl, pays: "attacker.testnet (not an approved vendor)" },
  policy: original.policy, spends_blocked: { before: blockedBefore, after: blockedAfter },
  transactions: Object.fromEntries(Object.entries(steps).map(([k, v]) => [k, { tx: v, link: explorerTx(v, net) }])),
  heartbeat: out.trim().split("\n").filter((l) => l.startsWith("-")),
};
writeFileSync(join(ROOT, `docs/evidence/blocked-spend-${net}.json`), JSON.stringify(record, null, 2) + "\n");
console.log(out);
console.log(`spends_blocked ${blockedBefore} -> ${blockedAfter}`);
if (blockedAfter <= blockedBefore) process.exit(1);
