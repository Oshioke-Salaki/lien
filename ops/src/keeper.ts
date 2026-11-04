// Does the permissionless chores for every business: forwards inbox income,
// forecloses what is past grace, settles finished auctions and refunds stuck jobs.
// Nothing here is privileged. Anyone can run it, and it can only move money to
// where the contracts say it is owed.
//
//   LIEN_NETWORK=testnet SIGNER=you.testnet npm run keeper

import { account, call, loadDeployment, network, sleep, view } from "./lib.js";

const net = network();
const d = loadDeployment(net);
const signerId = process.env.SIGNER;
if (!signerId) throw new Error("Set SIGNER to the account paying for gas");
const signer = account(signerId, net);
const once = process.env.ONCE === "1";
const FORECLOSE = process.env.FORECLOSE !== "0";

async function attempt(what: string, run: () => Promise<{ tx: string }>) {
  try {
    const { tx } = await run();
    console.log(`${what}: ${tx}`);
  } catch (error) {
    console.error(`${what} failed: ${String(error).slice(0, 200)}`);
  }
}

async function sweep() {
  for (const id of await view<string[]>(d.registry, "get_agents", { limit: 100 }, net)) {
    const a = await view<any>(id, "get_agent", {}, net);
    const inbox = BigInt(await view<string>(d.token, "ft_balance_of", { account_id: a.collector }, net));
    if (inbox > 0n) await attempt(`forward ${a.collector}`, () => call(signer, a.collector, "forward"));
    const loan = a.current_loan;
    if (!loan) continue;
    if (FORECLOSE && loan.status === "Active" && loan.foreclosable_at !== null && a.now >= loan.foreclosable_at) {
      await attempt(`foreclose ${id}`, () => call(signer, id, "foreclose"));
    }
    if (loan.status === "Foreclosed" && loan.auction.ends_at !== null && a.now >= loan.auction.ends_at) {
      await attempt(`settle ${id}`, () => call(signer, id, "settle_auction"));
    }
    if (loan.status === "Funding" && a.now >= loan.funding_deadline) {
      await attempt(`cancel ${id}`, () => call(signer, id, "cancel_offer"));
    }
  }
}

do {
  await sweep().catch((error) => console.error(String(error)));
  if (!once) await sleep(30_000);
} while (!once);
