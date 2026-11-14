// Moves a business to the published Sentinel build through its own governance: the owner
// proposes the change, and it takes effect once lenders holding more than half of the loan
// approve it. Nothing else in the service changes (price, limits, spend policy).
//
//   LIEN_NETWORK=testnet BUSINESS=sentinel.v1.lien-13569.testnet OWNER=owner.testnet LENDERS=a.testnet,b.testnet npm run upgrade

import { account, call, explorerTx, loadDeployment, network, view } from "./lib.js";

const net = network();
const d = loadDeployment(net);
const business = process.env.BUSINESS;
const ownerId = process.env.OWNER;
const lenders = (process.env.LENDERS ?? "").split(",").filter(Boolean);
if (!business || !ownerId || !d.sentinel) throw new Error("Set BUSINESS and OWNER, and publish a build first");

const before = await view<any>(business, "get_agent", {}, net);
if (before.service.wasm.hash === d.sentinel.hash) {
  console.log(`${business} already runs ${d.sentinel.hash}`);
  process.exit(0);
}
const service = { ...before.service, wasm: { url: d.sentinel.url, hash: d.sentinel.hash, build_target: d.sentinel.buildTarget } };

let proposal = before.proposal;
if (!proposal || proposal.service?.wasm?.hash !== d.sentinel.hash) {
  const sent = await call<number>(account(ownerId, net), business, "propose_change", { service }, { tgas: 60n });
  console.log(`proposed ${before.service.wasm.hash.slice(0, 12)}… → ${d.sentinel.hash.slice(0, 12)}…: ${explorerTx(sent.tx, net)}`);
  proposal = (await view<any>(business, "get_agent", {}, net)).proposal;
}
for (const lender of lenders) {
  const now = await view<any>(business, "get_agent", {}, net);
  if (now.service.wasm.hash === d.sentinel.hash) break;
  const sent = await call(account(lender, net), business, "approve_change", { proposal_id: proposal.id }, { tgas: 60n });
  console.log(`${lender} approved: ${explorerTx(sent.tx, net)}`);
}
const after = await view<any>(business, "get_agent", {}, net);
console.log(after.service.wasm.hash === d.sentinel.hash ? `${business} now runs ${d.sentinel.hash}` : `still waiting for approvals: ${JSON.stringify(after.proposal)}`);
