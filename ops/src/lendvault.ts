// Policy vault for the autonomous lender: a keyless contract that holds the agent's
// lending budget and lends only to businesses the Lien registry lists, within limits
// fixed at init. The agent account holds no full-access key, only a function-call key
// scoped to the vault's lend, claim and foreclose.
//
//   npx tsx src/lendvault.ts deploy              create the agent (function-call key only) and the keyless vault
//   npx tsx src/lendvault.ts fund [tusd]         register the vault with the token and mint test dollars to it
//   npx tsx src/lendvault.ts lend <business> <tusd>   lend through the vault, signed with the agent's function-call key
//   npx tsx src/lendvault.ts refuse <business>   lends the vault must refuse, sent on chain
//   npx tsx src/lendvault.ts claim <business> <loan_id>
//   npx tsx src/lendvault.ts withdraw <tusd>     the beneficiary pays itself (the only place a withdrawal can go)
//   npx tsx src/lendvault.ts status
//
// Testnet only. Everything sent is recorded in deployments/lendvault-testnet.json.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { Account, KeyPair, actions, nearToYocto, teraToGas, type KeyPairString } from "near-api-js";
import { ROOT, USD, account, explorerTx, sendProvider, view } from "./lib.js";

const NET = "testnet" as const;
if ((process.env.LIEN_NETWORK ?? "testnet") !== "testnet") throw new Error("lendvault runs on testnet only");

const TOKEN = "usd.lien-13569.testnet";
const REGISTRY = "v1.lien-13569.testnet";
/** The human who funds the vault. It creates both accounts and is the only place withdrawals go. */
const FUNDER = process.env.LENDVAULT_FUNDER ?? "lien-vault-48296.testnet";
const VAULT = process.env.LENDVAULT_ID ?? `lendvault.${FUNDER}`;
const AGENT = process.env.LENDVAULT_AGENT ?? `agent.${FUNDER}`;
const METHODS = ["lend", "claim", "foreclose"];
/** The policy, fixed at init. The same numbers as agents/lender/policy.json. */
const POLICY = { max_per_loan: 10n * USD, max_share_bps: 5000, total_budget: 30n * USD };
const VAULT_NEAR = "2.3";
const AGENT_NEAR = "1";
const KEY_ALLOWANCE = nearToYocto("1");
const RECORD = join(ROOT, "deployments", "lendvault-testnet.json");
const WASM = join(ROOT, "target", "near", "lien_lendvault", "lien_lendvault.wasm");
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

async function deploy() {
  const funder = account(FUNDER, NET);

  // 1. The agent: an account whose only key can call lend, claim and foreclose on the vault.
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
  const init = {
    token: TOKEN,
    registry: REGISTRY,
    beneficiary: FUNDER,
    agent: AGENT,
    max_per_loan: POLICY.max_per_loan.toString(),
    max_share_bps: POLICY.max_share_bps,
    total_budget: POLICY.total_budget.toString(),
  };
  const vaultTx = await send(funder, VAULT, [
    actions.createAccount(),
    actions.transfer(nearToYocto(VAULT_NEAR)),
    actions.deployContract(code),
    actions.functionCall("new", init, teraToGas(30), 0n),
  ]);
  if (vaultTx.failure) throw new Error(`vault creation failed (${vaultTx.hash}): ${JSON.stringify(vaultTx.failure)}`);
  console.log(`vault ${VAULT} created (${code.length} bytes): ${explorerTx(vaultTx.hash, NET)}`);

  const vaultKeys = await keys(VAULT);
  const agentKeys = await keys(AGENT);
  console.log(`access keys: ${VAULT} ${vaultKeys.length}; ${AGENT} ${agentKeys.length} (${agentKeys.map((k) => (k.access_key.permission === "FullAccess" ? "FullAccess" : "FunctionCall")).join(", ")})`);
  if (vaultKeys.length !== 0) throw new Error("the vault has an access key");
  if (agentKeys.some((k) => k.access_key.permission === "FullAccess")) throw new Error("the agent has a full-access key");
  save({ vault: VAULT, agent: AGENT, beneficiary: FUNDER, token: TOKEN, registry: REGISTRY, policy: init, agentKeyMethods: METHODS, agentTx: agentTx.hash, vaultTx: vaultTx.hash, codeBytes: code.length });
}

async function fund(tusd = "30") {
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

/** Signed with the agent's function-call key: no deposit, the vault attaches the 1 yoctoNEAR. */
async function lend(business: string, tusd: string) {
  const out = await send(agentAccount(), VAULT, [actions.functionCall("lend", { business, amount: units(tusd).toString() }, teraToGas(300), 0n)]);
  if (out.failure) throw new Error(`lend refused (${out.hash}): ${JSON.stringify(out.failure)}`);
  console.log(`lent through the vault: accepted ${out.value} of ${units(tusd)} by ${business}: ${explorerTx(out.hash, NET)}`);
  for (const line of out.logs.filter((l) => l.includes("EVENT_JSON"))) console.log(`  ${line}`);
  save({ lendTx: out.hash, lendBusiness: business, lendAccepted: out.value });
}

/** `business` should be one the vault lent to and that is still raising, for the share refusal. */
async function refuse(business: string) {
  const agent = agentAccount();
  const b = await view<{ current_loan: { id: number; terms: { principal: string } } | null }>(business, "get_agent", {}, NET);
  if (!b.current_loan) throw new Error(`${business} has no open loan`);
  const mine = await view<{ principal: string; in_flight: string } | null>(VAULT, "get_position", { business, loan_id: b.current_loan.id }, NET);
  const shareCap = (BigInt(b.current_loan.terms.principal) * BigInt(POLICY.max_share_bps)) / 10_000n;
  const overShare = shareCap - BigInt(mine?.principal ?? "0") - BigInt(mine?.in_flight ?? "0") + 1n;
  const attempts: Array<[string, string, object]> = [
    ["refuseCapTx", "above max_per_loan (11 tUSD > 10)", { business, amount: (11n * USD).toString() }],
    ["refuseShareTx", `above max_share_bps of one loan (${overShare} more on a cap of ${shareCap})`, { business, amount: overShare.toString() }],
    ["refuseNonBusinessTx", "to an ordinary account", { business: "lien-f4-3863.testnet", amount: USD.toString() }],
    ["refuseUnlistedTx", "to an account under the registry that it does not list", { business: "sentinel-x.v1.lien-13569.testnet", amount: USD.toString() }],
  ];
  for (const [key, what, args] of attempts) {
    const out = await send(agent, VAULT, [actions.functionCall("lend", args, teraToGas(300), 0n)]);
    if (!out.failure) throw new Error(`a lend ${what} was not refused: ${out.hash}`);
    console.log(`refused, ${what}: ${explorerTx(out.hash, NET)}\n  ${JSON.stringify(out.failure)}`);
    save({ [key]: out.hash });
  }
  // The key itself cannot reach anything else: NEAR rejects these before they run.
  for (const [receiver, method, args] of [
    [VAULT, "withdraw", { amount: "1" }],
    [TOKEN, "ft_transfer", { receiver_id: "lien-f4-3863.testnet", amount: "1" }],
  ] as const) {
    try {
      await send(agent, receiver, [actions.functionCall(method, args, teraToGas(30), 0n)]);
      throw new Error(`${method} on ${receiver} with the function-call key was accepted`);
    } catch (error) {
      const message = String(error).split("\n")[0] ?? "";
      if (message.includes("was accepted")) throw error;
      console.log(`rejected by NEAR before running, ${method} on ${receiver}: ${message}`);
    }
  }
}

async function claim(business: string, loanId: string) {
  const out = await send(agentAccount(), VAULT, [actions.functionCall("claim", { business, loan_id: Number(loanId) }, teraToGas(150), 0n)]);
  if (out.failure) throw new Error(`claim failed (${out.hash}): ${JSON.stringify(out.failure)}`);
  console.log(`claimed ${out.value}: ${explorerTx(out.hash, NET)}`);
}

async function withdraw(tusd: string) {
  const out = await send(account(FUNDER, NET), VAULT, [actions.functionCall("withdraw", { amount: units(tusd).toString() }, teraToGas(60), 0n)]);
  if (out.failure) throw new Error(`withdraw failed (${out.hash}): ${JSON.stringify(out.failure)}`);
  console.log(`withdrew ${out.value} to ${FUNDER}: ${explorerTx(out.hash, NET)}`);
  save({ withdrawTx: out.hash });
}

async function status() {
  const [policy, totals, positions, balance, vaultKeys, agentKeys] = await Promise.all([
    view(VAULT, "get_policy", {}, NET),
    view(VAULT, "get_totals", {}, NET),
    view(VAULT, "get_positions", {}, NET),
    view<string>(TOKEN, "ft_balance_of", { account_id: VAULT }, NET),
    keys(VAULT),
    keys(AGENT),
  ]);
  console.log(JSON.stringify({ vault: VAULT, policy, totals, positions, tokenBalance: balance, vaultKeys, agentKeys }, null, 2));
}

const [command, a, b] = process.argv.slice(2);
if (command === "deploy") await deploy();
else if (command === "fund") await fund(a);
else if (command === "lend" && a && b) await lend(a, b);
else if (command === "refuse" && a) await refuse(a);
else if (command === "claim" && a && b) await claim(a, b);
else if (command === "withdraw" && a) await withdraw(a);
else if (command === "status") await status();
else console.log("usage: tsx src/lendvault.ts deploy | fund [tusd] | lend <business> <tusd> | refuse <business> | claim <business> <loan_id> | withdraw <tusd> | status");
