// The market's heartbeat: a customer buys one real Sentinel check, so the business keeps
// earning and its lenders keep being repaid through the waterfall, on a schedule: about every
// three hours by GitHub Actions, whose scheduled runs can be delayed or skipped.
//
// It only ever buys work. It never forecloses, settles or cancels anything, so the demo
// businesses stay in the states the judges' guide describes. Run by
// .github/workflows/heartbeat.yml, or by hand:
//
//   LIEN_NETWORK=testnet BUYER=you.testnet npm run heartbeat
//
// In CI the buyer's key comes from the NEAR_PRIVATE_KEY secret (see lib.ts `account`).

import { appendFileSync } from "node:fs";
import { account, call, explorerTx, loadDeployment, network, pay, sleep, view } from "./lib.js";

const net = network();
if (net !== "testnet") throw new Error("The heartbeat buys test work; it runs on testnet only");
const d = loadDeployment(net);
const buyerId = process.env.BUYER ?? process.env.NEAR_ACCOUNT_ID;
if (!buyerId) throw new Error("Set BUYER (or NEAR_ACCOUNT_ID) to the customer account");
const buyer = account(buyerId, net);
const BUSINESS = process.env.BUSINESS ?? `sentinel.${d.registry}`;
const YOCTO = 10n ** 24n;
const TANK_FLOOR = 15n * 10n ** 22n; // 0.15 NEAR: about seven runs of compute left
const TANK_TOPUP = 3n * 10n ** 23n; // 0.3 NEAR
const MIN_GAP_SECS = 2 * 3600;

// Real accounts worth checking, so every report is a real answer about something that exists.
const TARGETS = [
  "outlayer.testnet",
  "wrap.testnet",
  d.registry,
  d.token,
  `sentinel.${d.registry}`,
  `sentinel-north.${d.registry}`,
  "intents.testnet",
  "ref-finance-101.testnet",
  "guest-book.testnet",
  "does-not-exist-anywhere.testnet",
];

const lines: string[] = [];
const say = (line: string) => { console.log(line); lines.push(line); };
const summary = () => { if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join("\n") + "\n"); };

async function main() {
  const agent = await view<any>(BUSINESS, "get_agent", {}, net);
  const price = BigInt(agent.service.price);
  const compute = BigInt(agent.service.compute_deposit);
  say(`## Heartbeat for ${agent.name}`);
  say("");
  say(`- Loan: ${agent.current_loan ? `${agent.current_loan.status}, ${Number(agent.current_loan.repaid) / 1e6} of ${Number(agent.current_loan.terms.total_due) / 1e6} ${d.tokenSymbol} repaid` : "none"}`);

  // Keep the business able to pay for compute. Funding the tank is open to anyone.
  const tank = BigInt(agent.tank);
  if (tank < TANK_FLOOR) {
    const state = await buyer.getState();
    const spare = BigInt(state.balance.available) - 10n ** 23n;
    if (spare > TANK_TOPUP) {
      const { tx } = await call(buyer, BUSINESS, "fund_tank", {}, { deposit: TANK_TOPUP, tgas: 30n });
      say(`- Topped up compute funds with 0.3 NEAR ([tx](${explorerTx(tx, net)}))`);
    } else {
      say(`- Compute funds are low (${Number(tank) / Number(YOCTO)} NEAR) and the buyer has none to spare. Top up the buyer.`);
    }
  }
  if (BigInt(agent.tank) + TANK_TOPUP < compute) { say("- Not enough compute funds for a run; skipping."); return; }

  // When OutLayer's shared testnet worker is backed up past NEAR's yield window, every check is
  // refunded. A scheduled run then skips buying (it would only add a refund) and probes again once
  // the last refund is over six hours old.
  if (process.env.GITHUB_EVENT_NAME === "schedule") {
    const last = await view<any[]>(BUSINESS, "get_jobs", { limit: 3 }, net);
    const allRefunded = last.length === 3 && last.every((job) => job.status === "Refunded");
    const age = last.length ? Number(agent.now) - Number(last[0].created_at) : Infinity;
    if (allRefunded && age < 6 * 3600) {
      say(`- The last 3 checks were refunded (OutLayer's testnet worker answered after NEAR's yield window), so this run skips buying and tries again later.`);
      return;
    }
  }

  // The workflow has two schedules, 90 minutes apart, because GitHub delays or drops scheduled
  // runs under load. When both fire, the second one sees the first's purchase and skips, so the
  // market still gets about one check every three hours, not two.
  if (process.env.GITHUB_EVENT_NAME === "schedule") {
    const recent = await view<any[]>(BUSINESS, "get_jobs", { limit: 10 }, net);
    const mine = recent.find((job) => job.payer === buyerId);
    const since = mine ? Number(agent.now) - Number(mine.created_at) : Infinity;
    if (since < MIN_GAP_SECS) {
      say(`- This buyer bought a check ${Math.round(since / 60)} minutes ago, so this scheduled run skips the purchase.`);
      return;
    }
  }

  // Keep the buyer able to pay. The test token has an open faucet.
  const held = BigInt(await view<string>(d.token, "ft_balance_of", { account_id: buyerId }, net));
  if (held < price) {
    await call(buyer, d.token, "faucet", { account_id: buyerId, amount: (100n * 10n ** BigInt(d.tokenDecimals)).toString() }, { tgas: 30n });
    say("- Took 100 test dollars from the token faucet");
  }

  const target = TARGETS[Math.floor(Date.now() / 3_600_000) % TARGETS.length];
  const jobId = Number(agent.next_job_id);
  const sent = await pay(buyer, d.token, BUSINESS, price, { action: "job", input: `check ${target}` });
  say(`- Bought a check of \`${target}\` for ${Number(price) / 1e6} ${d.tokenSymbol} ([tx](${explorerTx(sent.tx, net)}))`);

  // The payment settles once the enclave answers; read the job to report the outcome.
  for (let i = 0; i < 60; i++) {
    const job = await view<any>(BUSINESS, "get_job", { job_id: jobId }, net).catch(() => null);
    if (job && job.payer === buyerId && job.status !== "Pending") {
      const report = job.report ? JSON.parse(job.report) : null;
      say(job.status === "Done"
        ? `- Delivered from the pinned build ${String(job.wasm_hash).slice(0, 12)}…: **${report?.level ?? "?"} risk**${report?.flags?.length ? ` (${report.flags.join(", ")})` : ""}`
        : "- The run failed and the customer was refunded in full, as the contract promises");
      const after = await view<any>(BUSINESS, "get_agent", {}, net);
      if (after.current_loan) say(`- Lenders have now been repaid ${Number(after.current_loan.repaid) / 1e6} ${d.tokenSymbol}`);
      return;
    }
    await sleep(5_000);
  }
  say("- The enclave had not answered after five minutes; the job stays open and refunds itself if it expires.");
}

try {
  await main();
} catch (error) {
  say(`- Heartbeat failed: ${String(error).slice(0, 300)}`);
  summary();
  process.exit(1);
}
summary();
