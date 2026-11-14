// Lendvault v2 (contracts/lendvault2): the keyless policy vault that also buys a
// Sentinel check on the borrower's operator and will not lend until Sentinel's
// attested, on-chain verdict passes. The agent account has no full-access key,
// only a function-call key scoped to v2's hire_check, lend, claim and foreclose.
//
//   npx tsx src/lendvault2.ts deploy                   create the agent (function-call key only) and the keyless v2 vault
//   npx tsx src/lendvault2.ts fund [tusd]              register the vault with the token and mint test dollars to it
//   npx tsx src/lendvault2.ts hire <target> [key]      buy a Sentinel check through the vault and wait for its verdict
//   npx tsx src/lendvault2.ts lend <business> <tusd> <job_id> [key]   lend through the vault on that check
//   npx tsx src/lendvault2.ts refuse <business> <tusd> <job_id> <key>  a lend the vault must refuse, sent on chain
//   npx tsx src/lendvault2.ts claim <business> <loan_id>
//   npx tsx src/lendvault2.ts status
//
// Every agent call is signed with the agent's function-call key. Testnet only.
// Everything sent is recorded in deployments/lendvault2-testnet.json, under `key` when given.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { Account, KeyPair, actions, nearToYocto, teraToGas, type KeyPairString } from "near-api-js";
import { ROOT, USD, account, explorerTx, sendProvider, sleep, view } from "./lib.js";

const NET = "testnet" as const;
if ((process.env.LIEN_NETWORK ?? "testnet") !== "testnet") throw new Error("lendvault2 runs on testnet only");

const TOKEN = "usd.lien-13569.testnet";
const REGISTRY = "v1.lien-13569.testnet";
const SENTINEL = "sentinel.v1.lien-13569.testnet";
/** The human who funds the vault. It creates both accounts and is the only place withdrawals go. */
const FUNDER = process.env.LENDVAULT_FUNDER ?? "lien-vault-48296.testnet";
const VAULT = process.env.LENDVAULT2_ID ?? `lendvault2b.${FUNDER}`;
const AGENT = process.env.LENDVAULT2_AGENT ?? `agent2b.${FUNDER}`;
const METHODS = ["hire_check", "lend", "claim", "foreclose"];
/** The policy, fixed at init. Loan caps are v1's; checks are capped at 0.5 tUSD each, 5 tUSD in all, one day old at most. */
const POLICY = {
  token: TOKEN,
  registry: REGISTRY,
  sentinel: SENTINEL,
  beneficiary: FUNDER,
  agent: AGENT,
  max_per_loan: (10n * USD).toString(),
  max_share_bps: 5000,
  total_budget: (30n * USD).toString(),
  max_check_price: (USD / 2n).toString(),
  max_check_spend: (5n * USD).toString(),
  max_check_age_secs: 86_400,
  allow_warn: false,
};
const VAULT_NEAR = "2.9";
const AGENT_NEAR = "1.5";
/** NEAR reserves the full 300 Tgas at a pessimistic price (about 0.3 NEAR) against the allowance on every hire_check or lend, so 0.5 NEAR is too little (the first v2 deployment ran out). */
const KEY_ALLOWANCE = nearToYocto("3");
const RECORD = join(ROOT, "deployments", "lendvault2-testnet.json");
const WASM = join(ROOT, "target", "near", "lien_lendvault2", "lien_lendvault2.wasm");
/** Same layout as agents/lender/src/chain.ts: ~/.near-credentials/testnet/lien-lender/<account>/<receiver>.json */
const KEY_PATH = join(homedir(), ".near-credentials", NET, "lien-lender", AGENT, `${VAULT}.json`);

type Outcome = { hash: string; failure?: unknown; value?: unknown; logs: string[] };

async function send(signer: Account, receiverId: string, acts: ReturnType<typeof actions.transfer>[]): Promise<Outcome> {
  const outcome = await signer.signAndSendTransaction({ receiverId, actions: acts, waitUntil: "FINAL", throwOnFailure: false });
  const status = outcome.status as { SuccessValue?: string; Failure?: unknown };
  const raw = status.SuccessValue ? Buffer.from(status.SuccessValue, "base64").toString() : "";
  return {
    hash: outcome.transaction.hash,
    failure: status.Failure,
    value: raw ? JSON.parse(raw) : undefined,
    logs: (outcome.receipts_outcome ?? []).flatMap((r) => r.outcome.logs),
  };
}

function record(): Record<string, unknown> {
  return existsSync(RECORD) ? JSON.parse(readFileSync(RECORD, "utf8")) : {};
}
function save(update: Record<string, unknown>) {
  writeFileSync(RECORD, `${JSON.stringify({ ...record(), ...update }, null, 2)}\n`);
}

type KeyInfo = { access_key: { permission: "FullAccess" | { FunctionCall: { receiver_id: string; method_names: string[]; allowance: string | null } } }; public_key: string };
async function keys(id: string): Promise<KeyInfo[]> {
  const res = await fetch("https://rpc.testnet.fastnear.com", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "query", params: { request_type: "view_access_key_list", finality: "final", account_id: id } }),
  });
  const body = (await res.json()) as { result: { keys: KeyInfo[] } };
  return body.result.keys;
}

/** The agent's only key: a function-call key, read from the credentials folder. */
function agentAccount(): Account {
  if (!existsSync(KEY_PATH)) throw new Error(`No function-call key at ${KEY_PATH}. Run deploy first.`);
  const { private_key } = JSON.parse(readFileSync(KEY_PATH, "utf8")) as { private_key: KeyPairString };
  return new Account(AGENT, sendProvider(NET), private_key);
}

const units = (tusd: string) => BigInt(Math.round(Number(tusd) * 1_000_000));

/** The panic message of a failed transaction, from NEAR's nested failure object. */
function reason(failure: unknown): string {
  const text = JSON.stringify(failure);
  return /refused: [^"\\]*/.exec(text)?.[0] ?? text;
}

async function deploy() {
  const funder = account(FUNDER, NET);

  // 1. The agent: an account whose only key can call hire_check, lend, claim and foreclose on the v2 vault.
  if (existsSync(KEY_PATH)) throw new Error(`${KEY_PATH} already exists; refusing to overwrite it`);
  const pair = KeyPair.fromRandom("ed25519");
  mkdirSync(dirname(KEY_PATH), { recursive: true });
  writeFileSync(
    KEY_PATH,
    JSON.stringify({ account_id: AGENT, public_key: pair.getPublicKey().toString(), private_key: pair.toString(), receiver: VAULT, methods: METHODS }, null, 2),
    { mode: 0o600 },
  );
  const agentTx = await send(funder, AGENT, [
    actions.createAccount(),
    actions.transfer(nearToYocto(AGENT_NEAR)),
    actions.addFunctionCallAccessKey(pair.getPublicKey(), VAULT, METHODS, KEY_ALLOWANCE),
  ]);
  if (agentTx.failure) throw new Error(`agent creation failed (${agentTx.hash}): ${JSON.stringify(agentTx.failure)}`);
  console.log(`agent ${AGENT} created with one function-call key: ${explorerTx(agentTx.hash, NET)}`);

  // 2. The vault: create, fund, deploy, init in one transaction with no AddKey, so it never has a key.
  const code = readFileSync(WASM);
  const vaultTx = await send(funder, VAULT, [
    actions.createAccount(),
    actions.transfer(nearToYocto(VAULT_NEAR)),
    actions.deployContract(code),
    actions.functionCall("new", { policy: POLICY }, teraToGas(30), 0n),
  ]);
  if (vaultTx.failure) throw new Error(`vault creation failed (${vaultTx.hash}): ${JSON.stringify(vaultTx.failure)}`);
  console.log(`vault ${VAULT} created (${code.length} bytes): ${explorerTx(vaultTx.hash, NET)}`);

  const vaultKeys = await keys(VAULT);
  const agentKeys = await keys(AGENT);
  console.log(`access keys: ${VAULT} ${vaultKeys.length}; ${AGENT} ${agentKeys.length} (${agentKeys.map((k) => (k.access_key.permission === "FullAccess" ? "FullAccess" : "FunctionCall")).join(", ")})`);
  if (vaultKeys.length !== 0) throw new Error("the vault has an access key");
  if (agentKeys.some((k) => k.access_key.permission === "FullAccess")) throw new Error("the agent has a full-access key");
  save({ vault: VAULT, agent: AGENT, beneficiary: FUNDER, token: TOKEN, registry: REGISTRY, sentinel: SENTINEL, policy: POLICY, agentKeyMethods: METHODS, agentTx: agentTx.hash, vaultTx: vaultTx.hash, codeBytes: code.length });
}

async function fund(tusd = "20") {
  const funder = account(FUNDER, NET);
  const bounds = await view<{ min: string }>(TOKEN, "storage_balance_bounds", {}, NET);
  for (const id of [VAULT, FUNDER]) {
    const registered = await view(TOKEN, "storage_balance_of", { account_id: id }, NET);
    if (registered) continue;
    const out = await send(funder, TOKEN, [actions.functionCall("storage_deposit", { account_id: id, registration_only: true }, teraToGas(30), BigInt(bounds.min))]);
    if (out.failure) throw new Error(`storage_deposit for ${id} failed: ${JSON.stringify(out.failure)}`);
    console.log(`registered ${id} with ${TOKEN}: ${explorerTx(out.hash, NET)}`);
  }
  const out = await send(funder, TOKEN, [actions.functionCall("faucet", { account_id: VAULT, amount: units(tusd).toString() }, teraToGas(30), 0n)]);
  if (out.failure) throw new Error(`faucet failed: ${JSON.stringify(out.failure)}`);
  console.log(`minted ${tusd} tUSD to ${VAULT}: ${explorerTx(out.hash, NET)}`);
  save({ fundTx: out.hash, funded: units(tusd).toString() });
}

type Job = { id: number; payer: string; input: string; status: string; report: string | null; created_at: number; wasm_hash: string };

/** Signed with the agent's function-call key: the vault pays Sentinel from its own balance. */
async function hire(target: string, key = "hire") {
  const out = await send(agentAccount(), VAULT, [actions.functionCall("hire_check", { target }, teraToGas(300), 0n)]);
  if (out.failure) throw new Error(`hire_check failed (${out.hash}): ${JSON.stringify(out.failure)}`);
  const jobId = out.value as number | null;
  console.log(`hired a check on ${target} through the vault: job ${jobId}: ${explorerTx(out.hash, NET)}`);
  for (const line of out.logs.filter((l) => l.includes("EVENT_JSON"))) console.log(`  ${line}`);
  if (jobId === null || jobId === undefined) throw new Error("the vault paid but did not find its job");
  let job: Job | null = null;
  for (let i = 0; i < 40; i++) {
    job = await view<Job | null>(SENTINEL, "get_job", { job_id: jobId }, NET);
    if (job && job.status !== "Pending") break;
    await sleep(6_000);
  }
  console.log(`job ${jobId}: ${job?.status} ${job?.report ?? ""}`);
  save({ [`${key}Tx`]: out.hash, [`${key}JobId`]: jobId, [`${key}Target`]: target, [`${key}Status`]: job?.status, [`${key}Report`]: job?.report ? JSON.parse(job.report) : null });
}

async function lend(business: string, tusd: string, jobId: string, key = "lend") {
  const out = await send(agentAccount(), VAULT, [actions.functionCall("lend", { business, amount: units(tusd).toString(), check_job_id: Number(jobId) }, teraToGas(300), 0n)]);
  if (out.failure) throw new Error(`lend refused (${out.hash}): ${reason(out.failure)}`);
  console.log(`lent through the vault on check ${jobId}: accepted ${out.value} of ${units(tusd)} by ${business}: ${explorerTx(out.hash, NET)}`);
  for (const line of out.logs.filter((l) => l.includes("EVENT_JSON"))) console.log(`  ${line}`);
  save({ [`${key}Tx`]: out.hash, [`${key}Business`]: business, [`${key}JobId`]: Number(jobId), [`${key}Accepted`]: out.value, [`${key}SignedBy`]: `${AGENT}, function-call key only` });
}

async function refuse(business: string, tusd: string, jobId: string, key: string) {
  const out = await send(agentAccount(), VAULT, [actions.functionCall("lend", { business, amount: units(tusd).toString(), check_job_id: Number(jobId) }, teraToGas(300), 0n)]);
  if (!out.failure) throw new Error(`a lend on check ${jobId} was not refused: ${out.hash}`);
  const why = reason(out.failure);
  console.log(`refused, lend on check ${jobId}: ${explorerTx(out.hash, NET)}\n  ${why}`);
  save({ [`${key}Tx`]: out.hash, [`${key}JobId`]: Number(jobId), [`${key}Reason`]: why });
}

async function claim(business: string, loanId: string) {
  const out = await send(agentAccount(), VAULT, [actions.functionCall("claim", { business, loan_id: Number(loanId) }, teraToGas(150), 0n)]);
  if (out.failure) throw new Error(`claim failed (${out.hash}): ${JSON.stringify(out.failure)}`);
  console.log(`claimed ${out.value}: ${explorerTx(out.hash, NET)}`);
}

async function status() {
  const [policy, totals, positions, checks, balance, vaultKeys, agentKeys] = await Promise.all([
    view(VAULT, "get_policy", {}, NET),
    view(VAULT, "get_totals", {}, NET),
    view(VAULT, "get_positions", {}, NET),
    view(VAULT, "get_checks", {}, NET),
    view<string>(TOKEN, "ft_balance_of", { account_id: VAULT }, NET),
    keys(VAULT),
    keys(AGENT),
  ]);
  console.log(JSON.stringify({ vault: VAULT, policy, totals, positions, checks, tokenBalance: balance, vaultKeys, agentKeys }, null, 2));
}

const [command, a, b, c, d] = process.argv.slice(2);
if (command === "deploy") await deploy();
else if (command === "fund") await fund(a);
else if (command === "hire" && a) await hire(a, b);
else if (command === "lend" && a && b && c) await lend(a, b, c, d);
else if (command === "refuse" && a && b && c && d) await refuse(a, b, c, d);
else if (command === "claim" && a && b) await claim(a, b);
else if (command === "status") await status();
else console.log("usage: tsx src/lendvault2.ts deploy | fund [tusd] | hire <target> [key] | lend <business> <tusd> <job_id> [key] | refuse <business> <tusd> <job_id> <key> | claim <business> <loan_id> | status");
