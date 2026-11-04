// Builds the Sentinel agent and publishes it to FastFS, on-chain and public, so
// anyone can fetch the exact bytes and rebuild from source to compare.
//
//   LIEN_NETWORK=testnet SIGNER=you.testnet [VENDOR=data.testnet VENDOR_FEE=20000] npm run publish-agent

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { actions, teraToGas } from "near-api-js";
import { account, FASTFS_HOST, loadDeployment, network, OUTLAYER, ROOT, saveDeployment, sleep } from "./lib.js";

const net = network();
const signer = process.env.SIGNER;
if (!signer) throw new Error("Set SIGNER to the account that publishes the build");
const vendor = process.env.VENDOR;
const fee = process.env.VENDOR_FEE ?? "20000";

const crate = join(ROOT, "agents/sentinel");
execFileSync("cargo", ["build", "--release", "--locked", "--target", "wasm32-wasip2"], {
  cwd: crate,
  stdio: "inherit",
  env: { ...process.env, ...(vendor ? { SENTINEL_VENDOR: vendor, SENTINEL_VENDOR_FEE: fee } : {}) },
});
const wasm = readFileSync(join(crate, "target/wasm32-wasip2/release/sentinel.wasm"));
const hash = createHash("sha256").update(wasm).digest("hex");

// FastFS reads the file from the transaction's arguments. The contract has no
// such method, so the transaction fails on purpose once the data is on chain.
function string(value: string) {
  const bytes = Buffer.from(value);
  const length = Buffer.alloc(4);
  length.writeUInt32LE(bytes.length);
  return Buffer.concat([length, bytes]);
}
const length = Buffer.alloc(4);
length.writeUInt32LE(wasm.length);
const args = Buffer.concat([
  Buffer.from([0]),
  string(`${hash}.wasm`),
  Buffer.from([1]),
  string("application/wasm"),
  length,
  wasm,
]);

const receiver = OUTLAYER[net];
const url = `https://${FASTFS_HOST[net]}/${signer}/${receiver}/${hash}.wasm`;
await account(signer, net).signAndSendTransaction({
  receiverId: receiver,
  actions: [actions.functionCall("__fastdata_fastfs", args, teraToGas(1), 0n)],
  throwOnFailure: false,
  waitUntil: "INCLUDED",
});

for (let attempt = 0; ; attempt += 1) {
  const response = await fetch(url);
  if (response.ok) {
    const served = createHash("sha256").update(Buffer.from(await response.arrayBuffer())).digest("hex");
    if (served !== hash) throw new Error(`FastFS served ${served}, expected ${hash}`);
    break;
  }
  if (attempt > 30) throw new Error(`FastFS never served ${url}`);
  await sleep(5_000);
}

const deployment = loadDeployment(net);
deployment.sentinel = { url, hash, buildTarget: "wasm32-wasip2", ...(vendor ? { vendor } : {}) };
saveDeployment(deployment);
console.log(`Published and verified.\n  hash ${hash}\n  url  ${url}`);
