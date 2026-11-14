// Gives the lender agent its own testnet account, once:
//   1. a funded account (FUNDER, default v1.lien-13569.testnet) creates lien-lender-<n>.testnet
//      with 0.4 NEAR: ft_transfer_call is prepared with 300 Tgas, and NEAR reserves the
//      prepaid gas up front (most of it is refunded);
//   2. the agent takes test dollars through the token's faucet, the same path the app's
//      "Get test funds" button uses (storage_deposit + faucet in one transaction);
//   3. it adds a function-call key on the token scoped to ft_transfer_call, so the attack
//      demo can show what such a key can and cannot sign.
// The full-access key is written to ~/.near-credentials/testnet/<agent>.json, never to the repo.

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Account, KeyPair, type KeyPairString } from "near-api-js";
import { addFcKey, explorer, fullKeyAccount, provider, send } from "./chain";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CREDS = join(homedir(), ".near-credentials", "testnet");
const NEAR = 10n ** 24n;
const FUNDER = process.env.FUNDER ?? "v1.lien-13569.testnet";
const START_NEAR = (NEAR * 4n) / 10n;
const TEST_DOLLARS = 60_000_000n; // 60 tUSD
const policy = JSON.parse(readFileSync(join(ROOT, "policy.json"), "utf8")) as { token: string };
const agentFile = join(ROOT, "agent.json");

async function main() {
  if (existsSync(agentFile)) {
    console.log(`Already set up: ${readFileSync(agentFile, "utf8").trim()}`);
    return;
  }
  const funderKey = JSON.parse(readFileSync(join(CREDS, `${FUNDER}.json`), "utf8")) as { private_key: KeyPairString };
  const funder = new Account(FUNDER, provider(), funderKey.private_key);
  const spare = (await funder.getState()).balance.available;
  if (spare < START_NEAR + NEAR / 10n) throw new Error(`${FUNDER} has ${Number(spare) / 1e24} NEAR available; it needs ${Number(START_NEAR + NEAR / 10n) / 1e24}. Stopping.`);

  const id = `lien-lender-${Math.floor(Date.now() / 1000) % 1_000_000}.testnet`;
  const pair = KeyPair.fromRandom("ed25519");
  const path = join(CREDS, `${id}.json`);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify({ account_id: id, public_key: pair.getPublicKey().toString(), private_key: pair.toString() }), { mode: 0o600 });
  const created = await funder.createAccount({ newAccountId: id, publicKey: pair.getPublicKey(), nearToTransfer: START_NEAR });
  console.log(`created ${id} with 0.4 NEAR from ${FUNDER}: ${explorer(created.transaction.hash)}`);
  writeFileSync(agentFile, `${JSON.stringify({ account: id, created_tx: created.transaction.hash }, null, 2)}\n`);

  const me = fullKeyAccount(id);
  const faucet = await send(me, {
    signer_id: id,
    receiver_id: policy.token,
    actions: [
      { type: "FunctionCall", method_name: "storage_deposit", args: { account_id: id }, gas: "30000000000000", deposit: "1250000000000000000000" },
      { type: "FunctionCall", method_name: "faucet", args: { account_id: id, amount: TEST_DOLLARS.toString() }, gas: "30000000000000", deposit: "0" },
    ],
  });
  if (!faucet.ok) throw new Error(`faucet failed: ${faucet.failure}`);
  console.log(`registered on the token and took 60 tUSD from its faucet: ${explorer(faucet.tx)}`);

  const tokenKey = await addFcKey(me, policy.token, ["ft_transfer_call"], NEAR / 2n);
  console.log(`added a function-call key on ${policy.token} for ft_transfer_call only: ${explorer(tokenKey.tx)}`);
  writeFileSync(agentFile, `${JSON.stringify({ account: id, created_tx: created.transaction.hash, faucet_tx: faucet.tx, token_key_tx: tokenKey.tx }, null, 2)}\n`);
}

await main();
