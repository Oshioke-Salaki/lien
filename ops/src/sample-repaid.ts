// Creates one sample loan that is repaid in full, so the market's record shows the path a
// healthy loan takes: raised, repaid with interest, collected by its lender. All real
// transactions on testnet; the app labels the business as a sample run by the Lien team.
//
//   LIEN_NETWORK=testnet OWNER=owner.testnet LENDER=lender.testnet npm run sample-repaid

import { account, call, explorerTx, loadDeployment, network, pay, sentinelService, USD, view } from "./lib.js";

const net = network();
if (net !== "testnet") throw new Error("Samples are created on testnet only");
const d = loadDeployment(net);
const ownerId = process.env.OWNER;
const lenderId = process.env.LENDER;
if (!ownerId || !lenderId) throw new Error("Set OWNER and LENDER");
const owner = account(ownerId, net);
const lender = account(lenderId, net);
const DAY = 86_400;

const label = `beacon-repaid-${Math.floor(Date.now() / 1000) % 100000}`;
const id = `${label}.${d.registry}`;
const created = await call(owner, d.registry, "create_agent", {
  label,
  name: "Beacon",
  description: "Sells safety checks of NEAR accounts. A sample loan that was repaid in full, with interest, by its owner.",
  source_url: "https://github.com/Oshioke-Salaki/lien",
  service: sentinelService(d),
}, { deposit: 10n ** 24n });
console.log(`created ${id}: ${explorerTx(created.tx, net)}`);

const offered = await call(owner, id, "create_offer", {
  terms: {
    principal: (20n * USD).toString(),
    total_due: (22n * USD).toString(),
    lender_bps: 3_000,
    operator_bps: 2_000,
    funding_secs: 14 * DAY,
    term_secs: 30 * DAY,
    window_secs: 14 * DAY,
    min_payment_per_window: (5n * USD).toString(),
    grace_secs: 3 * DAY,
    auction_secs: 1_800,
    auction_reserve_bps: 10_000,
  },
});
console.log(`offered: ${explorerTx(offered.tx, net)}`);
const funded = await pay(lender, d.token, id, 20n * USD, { action: "fund", loan_id: 0 });
console.log(`funded by ${lenderId}: ${explorerTx(funded.tx, net)}`);
const sold = await pay(owner, d.token, id, USD / 4n, { action: "job", input: "check outlayer.testnet" });
console.log(`one real sale: ${explorerTx(sold.tx, net)}`);
const repaid = await pay(owner, d.token, id, 22n * USD, { action: "repay" });
console.log(`repaid in full by the owner: ${explorerTx(repaid.tx, net)}`);
const claimed = await call(lender, id, "claim", { loan_id: 0 }, { tgas: 100n });
console.log(`collected by the lender: ${explorerTx(claimed.tx, net)}`);
const loans = await view<any[]>(id, "get_loans", { limit: 5 }, net);
console.log(`loan 0: ${loans[0]?.status}, repaid ${Number(loans[0]?.repaid) / 1e6} of ${Number(loans[0]?.terms.total_due) / 1e6}`);
