// Keeps the demo market usable by every visitor, not just the first one. A late business
// can only be taken over once, and an auction ends once someone wins it, so this makes
// sure there is always:
//   - a business that is behind on a fast demo clock, for a visitor to take over, and
//   - a taken-over business whose auction is still open, for a visitor to bid on;
// and it completes any auction that has ended, which anyone may do.
//
// Everything it creates is a real business on testnet, labelled as a sample by the app.
// Run by .github/workflows/heartbeat.yml after each heartbeat, or by hand:
//
//   LIEN_NETWORK=testnet OWNER=you.testnet npm run restock

import { account, call, loadDeployment, network, pay, sentinelService, sleep, USD, view } from "./lib.js";

const net = network();
if (net !== "testnet") throw new Error("The restock runs on testnet only");
const d = loadDeployment(net);
const ownerId = process.env.OWNER ?? process.env.NEAR_ACCOUNT_ID;
if (!ownerId) throw new Error("Set OWNER (or NEAR_ACCOUNT_ID) to the account that owns the sample businesses");
const owner = account(ownerId, net);
const DAY = 86_400;
const NAMES = ["Lookout", "Watchtower", "Beacon"]; // the app labels these as sample businesses
const CREATE_DEPOSIT = 10n ** 24n; // 1 NEAR: the business's storage and compute funds
const lines: string[] = [];
const say = (line: string) => { console.log(line); lines.push(line); };

type Agent = { name: string; now: number; current_loan: null | { status: string; is_behind: boolean; foreclosable_at: number | null; auction: { high_bid: string; ends_at: number | null } } };

const terms = (o: Record<string, unknown>) => ({
  principal: (40n * USD).toString(),
  total_due: (44n * USD).toString(),
  lender_bps: 3_000,
  operator_bps: 2_000,
  funding_secs: 14 * DAY,
  term_secs: 30 * DAY,
  window_secs: 300,
  min_payment_per_window: (5n * USD).toString(),
  grace_secs: 300,
  auction_secs: 1_800,
  // The lowest bid is the whole debt: above the running money a buyer receives, so a taken-over
  // sample can never be bought for less than the cash inside it.
  auction_reserve_bps: 10_000,
  ...o,
});

async function ensureTokens() {
  const held = BigInt(await view<string>(d.token, "ft_balance_of", { account_id: ownerId }, net));
  if (held < 100n * USD) await call(owner, d.token, "faucet", { account_id: ownerId, amount: (500n * USD).toString() }, { tgas: 30n });
}

async function createSample(kind: "late" | "sale", existing: string[]) {
  // A name no sample uses yet, so the market never shows two of the same.
  const used = new Set(existing.map((id) => id.split(".")[0]!.split("-")[0]!));
  const name = NAMES.find((n) => !used.has(n.toLowerCase())) ?? NAMES[Math.floor(Date.now() / 1000) % NAMES.length]!;
  const label = `${name.toLowerCase().replace(/[^a-z0-9]/g, "")}-${kind}-${Math.floor(Date.now() / 1000) % 100000}`;
  const id = `${label}.${d.registry}`;
  const description = kind === "late"
    ? "Sells safety checks of NEAR accounts. A sample loan on a fast clock: it falls behind within minutes, so you can take it over."
    : "Sells safety checks of NEAR accounts. A sample loan that was taken over: it is for sale, and the auction starts with the first bid.";
  await call(owner, d.registry, "create_agent", { label, name, description, source_url: "https://github.com/Oshioke-Salaki/lien", service: sentinelService(d) }, { deposit: CREATE_DEPOSIT });
  await call(owner, id, "create_offer", { terms: terms({}) });
  await pay(owner, d.token, id, 40n * USD, { action: "fund", loan_id: 0 });
  // One real sale, so the page shows the waterfall and a delivered report.
  await pay(owner, d.token, id, USD / 4n, { action: "job", input: "check outlayer.testnet" });
  if (kind === "sale") {
    // Wait out the first payment window and the grace period, then take it over.
    for (let i = 0; i < 40; i++) {
      const a = await view<Agent>(id, "get_agent", {}, net);
      if (a.current_loan?.foreclosable_at && a.now >= a.current_loan.foreclosable_at) break;
      await sleep(30_000);
    }
    await call(owner, id, "foreclose");
  }
  say(`- Created **${name}** (\`${id}\`), ${kind === "late" ? "falling behind on a demo clock" : "taken over and open for bids"}`);
  existing.push(id);
}

async function main() {
  say("## Demo restock");
  const ids = await view<string[]>(d.registry, "get_agents", { limit: 100 }, net);
  const visible = ids.filter((id) => !id.startsWith("e2e-") && !id.startsWith("ui-"));
  let takeable = 0;
  let openAuctions = 0;
  for (const id of visible) {
    const a = await view<Agent>(id, "get_agent", {}, net).catch(() => null);
    const loan = a?.current_loan;
    if (!a || !loan) continue;
    if (loan.status === "Active" && (loan.is_behind || (loan.foreclosable_at !== null && loan.foreclosable_at - a.now < 1_200))) takeable++;
    if (loan.status === "Foreclosed") {
      const ended = loan.auction.ends_at !== null && a.now >= loan.auction.ends_at;
      if (ended) {
        await call(owner, id, "settle_auction").then(() => say(`- Completed the ended sale of ${a.name}`), (e) => say(`- Could not complete the sale of ${a.name}: ${String(e).slice(0, 120)}`));
      } else openAuctions++;
    }
  }
  say(`- Market: ${takeable} business(es) ready to take over, ${openAuctions} auction(s) open`);

  const state = await owner.getState();
  const spare = BigInt(state.balance.available);
  const needed = (takeable === 0 ? 1n : 0n) + (openAuctions === 0 ? 1n : 0n);
  if (needed === 0n) return;
  if (spare < needed * (CREATE_DEPOSIT + 2n * 10n ** 23n)) {
    say(`- Not enough NEAR to create ${needed} sample business(es); the owner holds ${Number(spare) / 1e24}. Top it up.`);
    return;
  }
  await ensureTokens();
  if (takeable === 0) await createSample("late", visible);
  if (openAuctions === 0) await createSample("sale", visible);
}

try {
  await main();
} catch (error) {
  say(`- Restock failed: ${String(error).slice(0, 300)}`);
  if (process.env.GITHUB_STEP_SUMMARY) (await import("node:fs")).appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join("\n") + "\n");
  process.exit(1);
}
if (process.env.GITHUB_STEP_SUMMARY) (await import("node:fs")).appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join("\n") + "\n");
