// The shared blocklist: a keyless registry where anyone can report a NEAR account
// with a reason, an evidence link and a 0.05 NEAR bond (contracts/reports).
//
//   FUNDER=a.testnet npx tsx src/reports.ts deploy          create the keyless registry account (testnet only)
//   REPORTER=a.testnet npx tsx src/reports.ts report <account> <reason> <evidence_url>
//   REPORTER=a.testnet npx tsx src/reports.ts retract <id>
//   npx tsx src/reports.ts show [account]                   reports on one account, or all of them
//
// The deploy is one transaction with no AddKey action, so the registry account never has a key.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { actions, nearToYocto } from "near-api-js";
import { ROOT, account, call, explorerTx, view } from "./lib.js";

const NET = "testnet" as const;
if ((process.env.LIEN_NETWORK ?? "testnet") !== "testnet") throw new Error("the reports registry runs on testnet only");

/** The parent account creates the registry as its sub-account. */
const PARENT = "lien-13569.testnet";
const REGISTRY = process.env.REPORTS_ID ?? `reports.${PARENT}`;
/** Optional: an account that tops up PARENT before the deploy. */
const FUNDER = process.env.FUNDER;
const BALANCE = process.env.REPORTS_NEAR ?? "1.6";
const BOND = 50_000_000_000_000_000_000_000n; // 0.05 NEAR
const RECORD = join(ROOT, "deployments", "reports-testnet.json");
const WASM = join(ROOT, "target", "near", "lien_reports", "lien_reports.wasm");

type Report = { id: number; account: string; reporter: string; reason: string; evidence_url: string; created_at_ms: number; bond: string; retracted_at_ms: number | null };

function record(): Record<string, unknown> {
  return existsSync(RECORD) ? JSON.parse(readFileSync(RECORD, "utf8")) : {};
}
function save(update: Record<string, unknown>) {
  writeFileSync(RECORD, `${JSON.stringify({ ...record(), ...update }, null, 2)}\n`);
}

async function keyCount(id: string) {
  const res = await fetch("https://rpc.testnet.fastnear.com", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "query", params: { request_type: "view_access_key_list", finality: "final", account_id: id } }),
  });
  const body = (await res.json()) as { result: { keys: unknown[] } };
  return body.result.keys.length;
}

async function deploy() {
  const code = readFileSync(WASM);
  let fundTx: string | undefined;
  if (FUNDER) {
    const top = await account(FUNDER, NET).signAndSendTransaction({ receiverId: PARENT, actions: [actions.transfer(nearToYocto("2"))], waitUntil: "FINAL" });
    fundTx = top.transaction.hash;
    console.log(`${FUNDER} sent 2 NEAR to ${PARENT}: ${explorerTx(fundTx, NET)}`);
  }
  console.log(`Creating ${REGISTRY} with ${BALANCE} NEAR for ${code.length} bytes of code, no access key`);
  const outcome = await account(PARENT, NET).signAndSendTransaction({
    receiverId: REGISTRY,
    actions: [actions.createAccount(), actions.transfer(nearToYocto(BALANCE as `${number}`)), actions.deployContract(code)],
    waitUntil: "FINAL",
    throwOnFailure: false,
  });
  const failure = (outcome.status as { Failure?: unknown }).Failure;
  if (failure) throw new Error(`deploy failed (${outcome.transaction.hash}): ${JSON.stringify(failure)}`);
  const keys = await keyCount(REGISTRY);
  console.log(`created ${explorerTx(outcome.transaction.hash, NET)}; access keys on ${REGISTRY}: ${keys}`);
  if (keys !== 0) throw new Error("the registry has an access key");
  const codeHash = (await (await fetch("https://rpc.testnet.fastnear.com", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "query", params: { request_type: "view_account", finality: "final", account_id: REGISTRY } }),
  })).json()) as { result: { code_hash: string } };
  save({ registry: REGISTRY, network: NET, parent: PARENT, ...(FUNDER ? { funder: FUNDER, fundTx } : {}), createTx: outcome.transaction.hash, codeBytes: code.length, codeHash: codeHash.result.code_hash, accessKeys: keys, bondYocto: BOND.toString() });
}

async function report(target: string, reason: string, evidence: string) {
  const reporter = process.env.REPORTER;
  if (!reporter) throw new Error("Set REPORTER to the account that files the report");
  const sent = await call<number>(account(reporter, NET), REGISTRY, "report", { account: target, reason, evidence_url: evidence }, { deposit: BOND, tgas: 30n });
  console.log(`REPORTED ${target} as report ${sent.result} by ${reporter}: ${explorerTx(sent.tx, NET)}`);
  const reports = record().reports as Array<Record<string, unknown>> | undefined;
  save({ reports: [...(reports ?? []), { id: sent.result, account: target, reporter, reason, evidence_url: evidence, tx: sent.tx }] });
}

async function retract(id: number) {
  const reporter = process.env.REPORTER;
  if (!reporter) throw new Error("Set REPORTER to the account that filed the report");
  const sent = await call(account(reporter, NET), REGISTRY, "retract", { id }, { tgas: 30n });
  console.log(`RETRACTED ${id}: ${explorerTx(sent.tx, NET)}`);
}

async function show(target?: string) {
  const rows = target ? await view<Report[]>(REGISTRY, "get_reports", { account: target }, NET) : await view<Report[]>(REGISTRY, "list_reports", { from: 0, limit: 100 }, NET);
  console.log(JSON.stringify(rows, null, 2));
}

const [cmd, ...rest] = process.argv.slice(2);
if (cmd === "deploy") await deploy();
else if (cmd === "report" && rest.length === 3) await report(rest[0]!, rest[1]!, rest[2]!);
else if (cmd === "retract" && rest.length === 1) await retract(Number(rest[0]));
else if (cmd === "show") await show(rest[0]);
else throw new Error("usage: reports.ts deploy | report <account> <reason> <evidence_url> | retract <id> | show [account]");
