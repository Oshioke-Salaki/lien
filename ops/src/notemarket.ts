// The note market: a keyless contract where a Lien loan share (a note) and its
// price change hands in one transaction, or not at all.
//
//   npx tsx src/notemarket.ts deploy                          create the keyless market account (testnet only)
//   SELLER=a.testnet npx tsx src/notemarket.ts list <business> <loan> <price>   list, move the note in, confirm
//   BUYER=b.testnet  npx tsx src/notemarket.ts buy <business> <loan>            pay the listed price in one ft_transfer_call
//   SELLER=a.testnet npx tsx src/notemarket.ts cancel <business> <loan>         take the listing down, note comes back
//   npx tsx src/notemarket.ts listings                        what is listed now
//   npx tsx src/notemarket.ts demo                            the recorded testnet run (sale, refused buys, cancel, sale back)
//
// Prices are in whole tUSD (6 decimals on chain).

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { actions, nearToYocto, teraToGas, type Account } from "near-api-js";
import { ROOT, USD, account, explorerTx, loadDeployment, sleep, view } from "./lib.js";

const NET = "testnet" as const;
if ((process.env.LIEN_NETWORK ?? "testnet") !== "testnet") throw new Error("the note market runs on testnet only");

const d = loadDeployment(NET);
/** The parent account creates the market as its sub-account and pays for its storage. */
const PARENT = "lien-13569.testnet";
const MARKET = process.env.NOTEMARKET_ID ?? `notemarket.${PARENT}`;
/** Optional: an account that tops up PARENT before the deploy. */
const FUNDER = process.env.FUNDER;
const MARKET_BALANCE = process.env.NOTEMARKET_NEAR ?? "2.3";
const BOND = 10n ** 22n; // 0.01 NEAR, returned on sale or cancel
const RECORD = join(ROOT, "deployments", "notemarket-testnet.json");
const WASM = join(ROOT, "target", "near", "lien_notemarket", "lien_notemarket.wasm");

/**
 * Retries a request the RPC turned away with 429. A rate-limited request is
 * refused at the gateway before it reaches a node, so a retry cannot send a
 * transaction twice.
 */
async function rateLimited<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt >= 5 || !String(error).includes("-429")) throw error;
      await sleep(5_000 * (attempt + 1));
    }
  }
}

type Outcome = { hash: string; link: string; failure?: unknown; value?: unknown; logs: string[]; refusals: string[] };

/** Sends one transaction and reports every receipt that failed, with its reason, instead of throwing. */
async function send(signer: Account, receiverId: string, method: string, args: object, deposit = 0n, tgas = 300): Promise<Outcome> {
  const outcome = await rateLimited(() =>
    signer.signAndSendTransaction({
      receiverId,
      actions: [actions.functionCall(method, args as Record<string, unknown>, teraToGas(tgas), deposit)],
      waitUntil: "FINAL",
      throwOnFailure: false,
    }),
  );
  const status = outcome.status as { SuccessValue?: string; Failure?: unknown };
  const raw = status.SuccessValue ? Buffer.from(status.SuccessValue, "base64").toString() : "";
  const receipts = outcome.receipts_outcome ?? [];
  return {
    hash: outcome.transaction.hash,
    link: explorerTx(outcome.transaction.hash, NET),
    failure: status.Failure,
    value: raw ? JSON.parse(raw) : undefined,
    logs: receipts.flatMap((r) => r.outcome.logs),
    refusals: receipts
      .map((r) => (r.outcome.status as { Failure?: unknown }).Failure)
      .filter(Boolean)
      .map((f) => JSON.stringify(f).match(/Smart contract panicked: ([^"\\]+)/)?.[1] ?? JSON.stringify(f).slice(0, 200)),
  };
}

function must(out: Outcome, what: string): Outcome {
  if (out.failure) throw new Error(`${what} failed (${out.link}): ${JSON.stringify(out.failure)}`);
  return out;
}

const note = (business: string, loanId: number, who: string) =>
  view<{ principal: string; claimed: string; claimable: string } | null>(business, "get_note", { loan_id: loanId, account_id: who }, NET);
const listing = (business: string, loanId: number) => view<Record<string, unknown> | null>(MARKET, "get_listing", { business, loan_id: loanId }, NET);
const balance = async (who: string) => BigInt(await view<string>(d.token, "ft_balance_of", { account_id: who }, NET));
const usd = (n: bigint) => `${(Number(n) / Number(USD)).toFixed(2)} tUSD`;

async function keyCount(id: string) {
  const res = await fetch("https://rpc.testnet.fastnear.com", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "query", params: { request_type: "view_access_key_list", finality: "final", account_id: id } }),
  });
  const body = (await res.json()) as { result: { keys: unknown[] } };
  return body.result.keys.length;
}

function record(): Record<string, unknown> {
  return existsSync(RECORD) ? JSON.parse(readFileSync(RECORD, "utf8")) : {};
}
function save(update: Record<string, unknown>) {
  writeFileSync(RECORD, `${JSON.stringify({ ...record(), ...update }, null, 2)}\n`);
}

async function deploy() {
  const code = readFileSync(WASM);
  if (FUNDER) {
    const top = await account(FUNDER, NET).signAndSendTransaction({
      receiverId: PARENT,
      actions: [actions.transfer(nearToYocto("2.5"))],
      waitUntil: "FINAL",
    });
    console.log(`${FUNDER} sent 2.5 NEAR to ${PARENT}: ${explorerTx(top.transaction.hash, NET)}`);
  }
  console.log(`Creating ${MARKET} with ${MARKET_BALANCE} NEAR for ${code.length} bytes of code, no access key`);
  // One transaction: create, fund, deploy, init. No AddKey action, so the account never has a key.
  const outcome = await account(PARENT, NET).signAndSendTransaction({
    receiverId: MARKET,
    actions: [
      actions.createAccount(),
      actions.transfer(nearToYocto(MARKET_BALANCE as `${number}`)),
      actions.deployContract(code),
      actions.functionCall("new", { token: d.token, registry: d.registry }, teraToGas(30), 0n),
    ],
    waitUntil: "FINAL",
    throwOnFailure: false,
  });
  const failure = (outcome.status as { Failure?: unknown }).Failure;
  if (failure) throw new Error(`deploy failed (${outcome.transaction.hash}): ${JSON.stringify(failure)}`);
  const keys = await keyCount(MARKET);
  console.log(`created ${explorerTx(outcome.transaction.hash, NET)}; access keys on ${MARKET}: ${keys}`);
  if (keys !== 0) throw new Error("the market has an access key");
  // The market must be registered with the token to receive payments.
  const reg = must(await send(account(PARENT, NET), d.token, "storage_deposit", { account_id: MARKET, registration_only: true }, 1_250_000_000_000_000_000_000n, 30), "storage_deposit");
  console.log(`registered with ${d.token}: ${reg.link}`);
  save({ market: MARKET, token: d.token, registry: d.registry, createTx: outcome.transaction.hash, registerTx: reg.hash, codeBytes: code.length, accessKeys: keys });
}

/** List, move the whole note to the market, confirm. Three transactions. */
async function list(sellerId: string, business: string, loanId: number, price: bigint) {
  const seller = account(sellerId, NET);
  const steps: Record<string, Outcome> = {};
  steps.list = must(await send(seller, MARKET, "list", { business, loan_id: loanId, price: price.toString() }, BOND), "list");
  if (steps.list.value !== true) throw new Error(`not listed (${steps.list.link}): ${steps.list.logs.join(" ")}`);
  console.log(`LISTED   ${sellerId} reserved ${business} loan ${loanId} at ${usd(price)}  ${steps.list.link}`);
  steps.transfer = must(await send(seller, business, "transfer_note", { loan_id: loanId, to: MARKET }, 1n, 30), "transfer_note");
  console.log(`MOVED    note -> ${MARKET}  ${steps.transfer.link}`);
  steps.confirm = must(await send(seller, MARKET, "confirm", { business, loan_id: loanId }), "confirm");
  if (steps.confirm.value !== true) throw new Error(`not confirmed (${steps.confirm.link}): ${steps.confirm.logs.join(" ")}`);
  console.log(`FOR SALE ${steps.confirm.link}`);
  return steps;
}

/** One ft_transfer_call. Returns the outcome whether the market accepted or refunded. */
async function buy(buyerId: string, business: string, loanId: number, amount: bigint) {
  const out = must(
    await send(account(buyerId, NET), d.token, "ft_transfer_call", { receiver_id: MARKET, amount: amount.toString(), msg: JSON.stringify({ buy: { business, loan_id: loanId } }) }, 1n),
    "ft_transfer_call",
  );
  // ft_transfer_call returns what the receiver kept.
  const kept = BigInt((out.value as string | undefined) ?? "0");
  console.log(`${kept === amount ? "BOUGHT  " : "REFUNDED"} ${buyerId} paid ${usd(amount)}, market kept ${usd(kept)}${out.refusals.length ? ` (${out.refusals.join("; ")})` : ""}  ${out.link}`);
  return { ...out, kept };
}

async function cancel(sellerId: string, business: string, loanId: number) {
  const out = must(await send(account(sellerId, NET), MARKET, "cancel", { business, loan_id: loanId }, 1n), "cancel");
  console.log(`CANCELLED ${out.link} ${out.logs.filter((l) => !l.startsWith("EVENT_JSON")).join(" ")}`);
  return out;
}

/** Notes only: the accounts' tUSD balances also move with unrelated live activity (jobs, heartbeats). */
async function snapshot(business: string, loanId: number, who: string[]) {
  const out: Record<string, unknown> = { listing: await listing(business, loanId), market: { note: await note(business, loanId, MARKET), tusd: (await balance(MARKET)).toString() } };
  for (const w of who) out[w] = { note: await note(business, loanId, w) };
  return out;
}

/** The amount the market paid `to` inside a transaction, read from the token's NEP-141 event. */
function paidTo(out: Outcome, to: string): string | null {
  for (const log of out.logs) {
    if (!log.startsWith("EVENT_JSON:")) continue;
    const e = JSON.parse(log.slice(11)) as { standard: string; event: string; data: { old_owner_id: string; new_owner_id: string; amount: string }[] };
    const hit = e.standard === "nep141" && e.event === "ft_transfer" ? e.data.find((x) => x.old_owner_id === MARKET && x.new_owner_id === to) : undefined;
    if (hit) return hit.amount;
  }
  return null;
}

const EVIDENCE = join(ROOT, "docs/evidence/note-market-testnet.json");
type Evidence = Record<string, unknown> & { before: Record<string, unknown>; steps: object[]; complete: boolean };

/** The recorded testnet run: a sale, two refused buys, a cancel, and a sale back, so the note ends where it started. */
async function demo() {
  const business = process.env.BUSINESS ?? "watchtower-late-5337.v1.lien-13569.testnet";
  const loanId = Number(process.env.LOAN ?? 0);
  const seller = process.env.SELLER ?? "lien-f4-3863.testnet";
  const buyer = process.env.BUYER ?? "lien-f5-3869.testnet";
  const stranger = process.env.STRANGER ?? "lien-f6-3876.testnet";
  const price = BigInt(process.env.PRICE ?? 30) * USD;
  const who = [seller, buyer, stranger];
  const short = (o: Outcome) => ({ tx: o.hash, link: o.link });

  const saved = existsSync(EVIDENCE) ? (JSON.parse(readFileSync(EVIDENCE, "utf8")) as Evidence) : null;
  const resume = saved && saved.complete === false ? saved : null;
  const evidence: Evidence = resume ?? {
    market: MARKET, business, loan: loanId, price: price.toString(), seller, buyer, stranger, started: new Date().toISOString(),
    before: await snapshot(business, loanId, who), steps: [], complete: false,
  };
  if (!resume && !(evidence.before[seller] as { note: unknown } | undefined)?.note) throw new Error(`${seller} holds no note on ${business} loan ${loanId}`);
  const persist = () => writeFileSync(EVIDENCE, `${JSON.stringify(evidence, null, 2)}\n`);

  const steps: Array<() => Promise<object>> = [
    async () => {
      const s = await list(seller, business, loanId, price);
      return { what: `${seller} lists its whole note at ${usd(price)}, moves it to the market, and the market confirms it holds it`, list: short(s.list!), transfer_note: short(s.transfer!), confirm: short(s.confirm!) };
    },
    async () => {
      const o = await buy(stranger, business, loanId, USD);
      if (o.kept !== 0n) throw new Error("a wrong price was accepted");
      return { what: `${stranger} offers ${usd(USD)} instead of the price; the market refuses and the token refunds it in the same transaction`, ...short(o), refused: o.refusals, kept: o.kept.toString() };
    },
    async () => {
      const o = await buy(buyer, business, loanId, price);
      if (o.kept !== price) throw new Error(`the sale did not go through: ${o.link}`);
      return { what: `${buyer} buys in one ft_transfer_call: the note moves to the buyer and the seller is paid, or neither`, ...short(o), kept: o.kept.toString(), sellerPaid: paidTo(o, seller), after: await snapshot(business, loanId, who) };
    },
    async () => {
      const o = await buy(stranger, business, loanId, USD);
      if (o.kept !== 0n) throw new Error("a second buy was accepted");
      return { what: `${stranger} tries to buy the sold note; it is no longer listed and the payment comes back`, ...short(o), refused: o.refusals, kept: o.kept.toString() };
    },
    async () => {
      const s = await list(buyer, business, loanId, price);
      const c = await cancel(buyer, business, loanId);
      return { what: `${buyer} lists the note it bought, then cancels; the note comes back to it`, list: short(s.list!), transfer_note: short(s.transfer!), confirm: short(s.confirm!), cancel: short(c), after: await snapshot(business, loanId, [buyer]) };
    },
    async () => {
      const s = await list(buyer, business, loanId, price);
      const o = await buy(seller, business, loanId, price);
      if (o.kept !== price) throw new Error(`the sale back did not go through: ${o.link}`);
      return { what: `${buyer} sells it back to ${seller} through the market, so the note ends where it started`, list: short(s.list!), transfer_note: short(s.transfer!), confirm: short(s.confirm!), buy: short(o), sellerPaid: paidTo(o, buyer) };
    },
  ];
  // Each step is saved as soon as it lands, so a run cut short resumes at the next step instead of repeating a sale.
  for (let i = evidence.steps.length; i < steps.length; i++) {
    evidence.steps.push(await steps[i]!());
    persist();
  }

  const after = await snapshot(business, loanId, who);
  const n = (s: Record<string, unknown>, w: string) => JSON.stringify((s[w] as { note: unknown } | undefined)?.note);
  evidence.after = after;
  evidence.finished = new Date().toISOString();
  evidence.restored = n(after, seller) === n(evidence.before, seller) && after.listing === null;
  evidence.complete = true;
  persist();
  console.log(evidence.restored ? "\nSaved docs/evidence/note-market-testnet.json" : "\n!! the note did not end where it started; see the evidence file");
}

const [command, ...args] = process.argv.slice(2);
const business = args[0] ?? "";
const loanId = Number(args[1] ?? 0);
if (command === "deploy") await deploy();
else if (command === "list") await list(process.env.SELLER ?? "", business, loanId, BigInt(Math.round(Number(args[2]) * 1e6)));
else if (command === "buy") {
  const l = await listing(business, loanId);
  if (!l) throw new Error("not listed");
  await buy(process.env.BUYER ?? "", business, loanId, BigInt(l.price as string));
} else if (command === "cancel") await cancel(process.env.SELLER ?? "", business, loanId);
else if (command === "listings") console.log(JSON.stringify(await view(MARKET, "get_listings", {}, NET), null, 2));
else if (command === "demo") await demo();
else console.log("usage: tsx src/notemarket.ts deploy | list <business> <loan> <price> | buy <business> <loan> | cancel <business> <loan> | listings | demo");
