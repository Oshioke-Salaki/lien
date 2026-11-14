// Gives the borrower agent its own testnet account and its business, once:
//   1. a funded account (FUNDER, default lien-f4-3863.testnet) creates lien-borrower-<n>.testnet
//      with 1.1 NEAR: 0.5 is the business's deposit, the rest pays gas;
//   2. the agent registers on the test-dollar token and takes 20 tUSD from its faucet
//      (the app's "Get test funds" path), so it can hire Sentinel and repay;
//   3. it creates its business, Courier, on the registry. The business holds no keys and
//      runs the pinned Sentinel build; the agent is its operator.
// The key is written to ~/.near-credentials/testnet/<agent>.json, never to the repo.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { KeyPair } from "near-api-js";
import { explorer, keyAccount, sendCalls } from "./chain";
import type { BorrowerPolicy } from "./terms";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CREDS = join(homedir(), ".near-credentials", "testnet");
const NEAR = 10n ** 24n;
const TGAS = 10n ** 12n;
const FUNDER = process.env.FUNDER ?? "lien-f4-3863.testnet";
const START_NEAR = (NEAR * 11n) / 10n;
const policy = JSON.parse(readFileSync(join(ROOT, "policy.json"), "utf8")) as BorrowerPolicy;
const deployment = JSON.parse(readFileSync(join(ROOT, "../../deployments/testnet.json"), "utf8")) as { sentinel: { url: string; hash: string; buildTarget: string; vendor?: string } };
const agentFile = join(ROOT, "agent.json");
const save = (o: object) => writeFileSync(agentFile, `${JSON.stringify(o, null, 2)}\n`);

/** The same service every Sentinel-style business starts from (ops/src/lib.ts sentinelService). */
const service = () => ({
  wasm: { url: deployment.sentinel.url, hash: deployment.sentinel.hash, build_target: deployment.sentinel.buildTarget },
  price: "250000",
  max_instructions: 10_000_000_000,
  max_memory_mb: 128,
  max_execution_seconds: 60,
  compute_deposit: (2n * 10n ** 22n).toString(),
  secrets_profile: null,
  policy: { vendors: deployment.sentinel.vendor ? [deployment.sentinel.vendor] : [], max_per_tx: "100000", max_per_day: "5000000" },
});

async function main() {
  let state: Record<string, string> = existsSync(agentFile) ? JSON.parse(readFileSync(agentFile, "utf8")) : {};
  if (!state.account) {
    const funder = keyAccount(FUNDER);
    const spare = (await funder.getState()).balance.available;
    if (spare < START_NEAR + NEAR / 5n) throw new Error(`${FUNDER} has ${Number(spare) / 1e24} NEAR available; it needs ${Number(START_NEAR + NEAR / 5n) / 1e24}. Stopping.`);
    const id = `lien-borrower-${Math.floor(Date.now() / 1000) % 1_000_000}.testnet`;
    const pair = KeyPair.fromRandom("ed25519");
    const path = join(CREDS, `${id}.json`);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify({ account_id: id, public_key: pair.getPublicKey().toString(), private_key: pair.toString() }), { mode: 0o600 });
    const created = await funder.createAccount({ newAccountId: id, publicKey: pair.getPublicKey(), nearToTransfer: START_NEAR });
    console.log(`created ${id} with 1.1 NEAR from ${FUNDER}: ${explorer(created.transaction.hash)}`);
    state = { account: id, created_tx: created.transaction.hash };
    save(state);
  }
  const me = keyAccount(state.account!);
  if (!state.faucet_tx) {
    const faucet = await sendCalls(me, policy.token, [
      { method: "storage_deposit", args: { account_id: state.account }, gas: 30n * TGAS, deposit: 1_250_000_000_000_000_000_000n },
      { method: "faucet", args: { account_id: state.account, amount: "20000000" }, gas: 30n * TGAS, deposit: 0n },
    ]);
    if (!faucet.ok) throw new Error(`faucet failed: ${faucet.failure}`);
    console.log(`registered on the token and took 20 tUSD from its faucet: ${explorer(faucet.tx)}`);
    state = { ...state, faucet_tx: faucet.tx };
    save(state);
  }
  if (!state.business) {
    const label = `${policy.business.label_prefix}-${Math.floor(Date.now() / 1000) % 100_000}`;
    const created = await sendCalls(me, policy.registry, [{
      method: "create_agent",
      args: { label, name: policy.business.name, description: policy.business.description, source_url: "https://github.com/Oshioke-Salaki/lien", service: service() },
      gas: 150n * TGAS,
      deposit: NEAR / 2n,
    }]);
    if (!created.ok) throw new Error(`create_agent failed: ${created.failure}`);
    const business = `${label}.${policy.registry}`;
    console.log(`created ${business}, operated by ${state.account}: ${explorer(created.tx)}`);
    state = { ...state, business, business_tx: created.tx };
    save(state);
  }
  console.log(JSON.stringify(state, null, 2));
}

await main();
