// Turns on the NEAR AI verdict for a business with no open loan: moves it to the published
// Sentinel build with secrets_profile "default". Then store the key with `npm run store-secret`,
// which seals it so only that exact build, called through that business, can read it.
//
//   LIEN_NETWORK=testnet BUSINESS=beacon-repaid-7978.v1.lien-13569.testnet OPERATOR=lien-f4-3863.testnet npm run enable-ai

import { account, call, explorerTx, loadDeployment, network, view } from "./lib.js";

const net = network();
const d = loadDeployment(net);
const business = process.env.BUSINESS;
const operatorId = process.env.OPERATOR;
if (!business || !operatorId || !d.sentinel) throw new Error("Set BUSINESS and OPERATOR, and publish a build first");
const agent = await view<any>(business, "get_agent", {}, net);
if (agent.current_loan) throw new Error(`${business} has an open loan; during a loan its build changes only through lender governance, and secrets cannot change`);
const service = { ...agent.service, wasm: { url: d.sentinel.url, hash: d.sentinel.hash, build_target: d.sentinel.buildTarget }, secrets_profile: "default" };
const { tx } = await call(account(operatorId, net), business, "update_service", { service }, { tgas: 30n });
console.log(`${business} now runs ${d.sentinel.hash.slice(0, 12)}… with secrets profile "default": ${explorerTx(tx, net)}`);
