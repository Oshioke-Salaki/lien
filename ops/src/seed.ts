// Creates demo businesses on testnet in each state a visitor should be able to
// see and act on. All of it is real on-chain activity, not sample data.
//
//   LIEN_NETWORK=testnet ROLES=operator,alice,bob,customer,bidder npm run seed

import { account, call, loadDeployment, network, pay, sentinelService, sleep, USD, view } from "./lib.js";

const net = network();
if (net !== "testnet") throw new Error("The seed only runs on testnet");
const d = loadDeployment(net);
const [operatorId, aliceId, bobId, customerId] = (process.env.ROLES ?? "").split(",");
if (!operatorId || !aliceId || !bobId || !customerId) throw new Error("Set ROLES=operator,alice,bob,customer");
const [operator, alice, bob, customer] = [operatorId, aliceId, bobId, customerId].map((id) => account(id, net)) as [ReturnType<typeof account>, ReturnType<typeof account>, ReturnType<typeof account>, ReturnType<typeof account>];

const DAY = 86_400;
const tag = process.env.SEED_TAG ?? "";

async function create(label: string, name: string, description: string) {
  const id = `${label}${tag}.${d.registry}`;
  const exists = await operator.provider.viewAccount({ accountId: id }).then(() => true, () => false);
  if (exists) {
    console.log(`${id} already exists`);
    return id;
  }
  await call(operator, d.registry, "create_agent", {
    label: `${label}${tag}`,
    name,
    description,
    source_url: "https://github.com/Oshioke-Salaki/lien",
    service: sentinelService(d),
  }, { deposit: 10n ** 24n });
  console.log(`created ${id}`);
  return id;
}

async function runJob(agent: string, input: string) {
  const before = (await view<any>(agent, "get_agent", {}, net)).next_job_id as number;
  await pay(customer, d.token, agent, USD / 4n, { action: "job", input });
  for (let i = 0; i < 40; i += 1) {
    const job = await view<any>(agent, "get_job", { job_id: before }, net);
    if (job?.status !== "Pending") {
      console.log(`  job ${before} ${job?.status}: ${input}`);
      return;
    }
    await sleep(3_000);
  }
  throw new Error("job did not settle");
}

const terms = (o: Partial<Record<string, unknown>>) => ({
  principal: (100n * USD).toString(),
  total_due: (110n * USD).toString(),
  lender_bps: 3_000,
  operator_bps: 2_000,
  funding_secs: 14 * DAY,
  term_secs: 90 * DAY,
  window_secs: 14 * DAY,
  min_payment_per_window: (5n * USD).toString(),
  grace_secs: 3 * DAY,
  auction_secs: 7 * DAY,
  auction_reserve_bps: 5_000,
  ...o,
});

for (const person of [alice, bob, customer, operator]) {
  await call(alice, d.token, "storage_deposit", { account_id: person.accountId }, { deposit: 1_250_000_000_000_000_000_000n, tgas: 30n });
  await call(alice, d.token, "faucet", { account_id: person.accountId, amount: (1000n * USD).toString() }, { tgas: 30n });
}

// A healthy loan with real customers.
const healthy = await create("sentinel", "Sentinel", "Checks a NEAR account before an agent pays or signs. Healthy loan, paying on time.");
if ((await view<any>(healthy, "get_agent", {}, net)).loan_count === 0) {
  await call(operator, healthy, "create_offer", { terms: terms({}) });
  await pay(alice, d.token, healthy, 60n * USD, { action: "fund", loan_id: 0 });
  await pay(bob, d.token, healthy, 40n * USD, { action: "fund", loan_id: 0 });
  await pay(operator, d.token, healthy, 15n * USD, { action: "repay" });
  for (const input of ["is outlayer.testnet safe?", `check ${d.token}`, "does-not-exist-here.testnet", `is ${d.registry} safe to pay?`, "check near-faucet.testnet"]) {
    await runJob(healthy, input);
  }
}

// A loan still raising, for a visitor to fund.
const raising = await create("sentinel-north", "Sentinel North", "A second Sentinel, raising its first loan. Fund it to see a note in your positions.");
if ((await view<any>(raising, "get_agent", {}, net)).loan_count === 0) {
  await call(operator, raising, "create_offer", { terms: terms({ principal: (50n * USD).toString(), total_due: (55n * USD).toString() }) });
  await pay(alice, d.token, raising, 20n * USD, { action: "fund", loan_id: 0 });
}

// A loan on short clocks that falls behind by itself, for a visitor to foreclose.
const late = await create("sentinel-late", "Sentinel Late", "On demo clocks and not paying. Anyone can foreclose it once its grace runs out.");
if ((await view<any>(late, "get_agent", {}, net)).loan_count === 0) {
  await call(operator, late, "create_offer", { terms: terms({ principal: (40n * USD).toString(), total_due: (44n * USD).toString(), term_secs: 30 * DAY, window_secs: 300, grace_secs: 300, auction_secs: 1_800 }) });
  await pay(bob, d.token, late, 40n * USD, { action: "fund", loan_id: 0 });
  await runJob(late, "is outlayer.testnet safe?");
}

// Already foreclosed and waiting for bids.
const sale = await create("sentinel-sale", "Sentinel Sale", "Foreclosed and still serving customers. Bid to buy a running business.");
if ((await view<any>(sale, "get_agent", {}, net)).loan_count === 0) {
  await call(operator, sale, "create_offer", { terms: terms({ principal: (30n * USD).toString(), total_due: (33n * USD).toString(), term_secs: 30 * DAY, window_secs: 15, grace_secs: 5, auction_secs: 1_800, auction_reserve_bps: 2_000 }) });
  await pay(alice, d.token, sale, 30n * USD, { action: "fund", loan_id: 0 });
  await sleep(25_000);
  await call(bob, sale, "foreclose");
  await runJob(sale, "still serving after foreclosure?");
}

console.log(JSON.stringify((await view<string[]>(d.registry, "get_agents", {}, net))));
