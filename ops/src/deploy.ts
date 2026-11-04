// Publishes the global contract code and deploys the registry.
//
//   LIEN_NETWORK=testnet ROOT_ACCOUNT=you.testnet npm run deploy
//
// Costs about 42 NEAR to publish the global code, which is burned, plus a few NEAR
// of refundable storage. On testnet it also deploys a test stablecoin. On mainnet
// it uses real USDC.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import bs58 from "./base58.js";
import { KeyPair, nearToYocto } from "near-api-js";
import { homedir } from "node:os";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { account, call, MAINNET_USDC, network, OUTLAYER, ROOT, saveDeployment, view, type Deployment } from "./lib.js";

const net = network();
const rootId = process.env.ROOT_ACCOUNT;
if (!rootId) throw new Error("Set ROOT_ACCOUNT to the account paying for the deployment");
const root = account(rootId, net);
const registryId = `${process.env.REGISTRY_PREFIX ?? "v1"}.${rootId}`;

const read = (name: string) => readFileSync(join(ROOT, `target/near/${name}/${name}.wasm`));
const hashOf = (code: Buffer) => bs58(createHash("sha256").update(code).digest());

async function exists(id: string) {
  try {
    await root.provider.viewAccount({ accountId: id });
    return true;
  } catch {
    return false;
  }
}

/** Creates a sub-account and stores its key the way the NEAR CLI does. */
async function subAccount(id: string, near: `${number}`) {
  if (await exists(id)) return account(id, net);
  const pair = KeyPair.fromRandom("ed25519");
  await root.createAccount({ newAccountId: id, publicKey: pair.getPublicKey(), nearToTransfer: nearToYocto(near) });
  const dir = join(homedir(), ".near-credentials", net);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${id}.json`), JSON.stringify({ account_id: id, public_key: pair.getPublicKey().toString(), private_key: pair.toString() }), { mode: 0o600 });
  return account(id, net);
}

const agentCode = read("lien_agent");
const collectorCode = read("lien_collector");
for (const [name, code] of [["agent", agentCode], ["collector", collectorCode]] as const) {
  console.log(`Publishing global ${name} code, ${hashOf(code)}`);
  await root.deployGlobalContract(code, "codeHash");
}

let token = MAINNET_USDC;
let tokenSymbol = "USDC";
if (net === "testnet") {
  token = `usd.${rootId}`;
  tokenSymbol = "tUSD";
  const tokenAccount = await subAccount(token, "3");
  const metadata = await view(token, "ft_metadata", {}, net).catch(() => null);
  if (!metadata) {
    await tokenAccount.deployContract(read("lien_mock_token"));
    await call(tokenAccount, token, "new");
  }
  console.log(`Test token at ${token}`);
}

const registry = await subAccount(registryId, "4");
await registry.deployContract(read("lien_registry"));
await call(registry, registryId, "new", {
  token,
  outlayer: OUTLAYER[net],
  agent_code: hashOf(agentCode),
  collector_code: hashOf(collectorCode),
});

const deployment: Deployment = {
  network: net,
  registry: registryId,
  token,
  tokenSymbol,
  tokenDecimals: 6,
  outlayer: OUTLAYER[net],
  agentCode: hashOf(agentCode),
  collectorCode: hashOf(collectorCode),
};
saveDeployment(deployment);
if (existsSync(join(ROOT, "web/src"))) console.log("Update web config: npm run sync-config in web/");
console.log(`Registry at ${registryId}`);
