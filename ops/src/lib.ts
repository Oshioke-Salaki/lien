// Shared plumbing for the operations scripts. Keys come from the standard NEAR
// credentials folder and are never printed or written anywhere else.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Account, FailoverRpcProvider, JsonRpcProvider, actions, teraToGas, type KeyPairString } from "near-api-js";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");

export type Network = "testnet" | "mainnet";

export type Deployment = {
  network: Network;
  registry: string;
  token: string;
  tokenSymbol: string;
  tokenDecimals: number;
  outlayer: string;
  agentCode: string;
  collectorCode: string;
  sentinel?: { url: string; hash: string; buildTarget: string; vendor?: string };
};

export const RPC: Record<Network, string> = {
  testnet: "https://rpc.testnet.fastnear.com",
  mainnet: "https://free.rpc.fastnear.com",
};

/** Independent providers from NEAR's list, tried in turn when one throttles or fails. */
export const RPC_FALLBACKS: Record<Network, string[]> = {
  testnet: ["https://rpc.testnet.fastnear.com", "https://testnet-rpc.intea.rs", "https://near-testnet.drpc.org", "https://api.zan.top/near-testnet"],
  mainnet: ["https://free.rpc.fastnear.com", "https://rpc.intea.rs", "https://near.drpc.org", "https://api.zan.top/near-mainnet"],
};

export const OUTLAYER: Record<Network, string> = { testnet: "outlayer.testnet", mainnet: "outlayer.near" };
export const OUTLAYER_API: Record<Network, string> = {
  testnet: "https://testnet-api.outlayer.ai",
  mainnet: "https://api.outlayer.ai",
};
export const FASTFS_HOST: Record<Network, string> = { testnet: "test.fastfs.io", mainnet: "main.fastfs.io" };
/** Native USDC on NEAR. */
export const MAINNET_USDC = "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";

export const USD = 1_000_000n;

export function network(): Network {
  const value = process.env.LIEN_NETWORK ?? "testnet";
  if (value !== "testnet" && value !== "mainnet") throw new Error(`Unknown network: ${value}`);
  return value;
}

/**
 * Transactions go through one provider, so a refusal (not enough balance, a contract
 * error) is reported as itself instead of being retried on every provider and lost.
 */
export function sendProvider(net: Network = network()) {
  return new JsonRpcProvider({ url: RPC[net] });
}

export function provider(net: Network = network()) {
  return new FailoverRpcProvider(RPC_FALLBACKS[net].map((url) => new JsonRpcProvider({ url })));
}

export function account(accountId: string, net: Network = network()): Account {
  // In CI the key comes from a secret, for exactly one named account, and is never written to disk.
  if (process.env.NEAR_ACCOUNT_ID === accountId && process.env.NEAR_PRIVATE_KEY) {
    return new Account(accountId, sendProvider(net), process.env.NEAR_PRIVATE_KEY as KeyPairString);
  }
  const path = join(homedir(), ".near-credentials", net, `${accountId}.json`);
  if (!existsSync(path)) {
    throw new Error(`No key for ${accountId} at ${path}. Run: near account import-account, or create it with the CLI.`);
  }
  const { private_key: key } = JSON.parse(readFileSync(path, "utf8")) as { private_key: KeyPairString };
  return new Account(accountId, sendProvider(net), key);
}

export type CallOptions = { deposit?: bigint; tgas?: bigint };

export type Sent<T> = { tx: string; result: T; logs: string[]; failedOn: string[] };

/**
 * Sends a transaction and throws if the call itself failed. A failed side effect,
 * such as a payout to an account with no token registration, is reported in
 * `failedOn` instead, because the contract is designed to survive those.
 */
export async function call<T = unknown>(
  signer: Account,
  contractId: string,
  methodName: string,
  args: object = {},
  { deposit = 0n, tgas = 300n }: CallOptions = {},
): Promise<Sent<T>> {
  const outcome = await signer.signAndSendTransaction({
    receiverId: contractId,
    actions: [actions.functionCall(methodName, args as Record<string, unknown>, teraToGas(Number(tgas)), deposit)],
    waitUntil: "FINAL",
    throwOnFailure: false,
  });
  const status = outcome.status as { SuccessValue?: string; Failure?: unknown };
  if (status.Failure) {
    throw new Error(`${methodName} on ${contractId} failed: ${JSON.stringify(status.Failure)}`);
  }
  const receipts = outcome.receipts_outcome ?? [];
  const raw = status.SuccessValue ? Buffer.from(status.SuccessValue, "base64").toString() : "";
  return {
    tx: outcome.transaction.hash,
    result: (raw ? JSON.parse(raw) : undefined) as T,
    logs: receipts.flatMap((r) => r.outcome.logs),
    failedOn: receipts
      .filter((r) => (r.outcome.status as { Failure?: unknown }).Failure)
      .map((r) => r.outcome.executor_id),
  };
}

export async function view<T = any>(contractId: string, method: string, args: object = {}, net: Network = network()): Promise<T> {
  return (await provider(net).callFunction({ contractId, method, args: args as Record<string, unknown> })) as T;
}

/** Like `call`, for steps a scenario expects to be refused. Returns the reason. */
export async function refused(signer: Account, contractId: string, method: string, args: object = {}, options: CallOptions = {}): Promise<string> {
  try {
    await call(signer, contractId, method, args, options);
  } catch (error) {
    return String(error);
  }
  throw new Error(`${method} should have been refused but succeeded`);
}

/** A token payment. Throws if the receiving contract refused it, since the token
 *  then quietly sends the money back and the transaction still "succeeds". */
export async function pay(signer: Account, token: string, receiver: string, amount: bigint, msg: object) {
  const sent = await call<string>(
    signer,
    token,
    "ft_transfer_call",
    { receiver_id: receiver, amount: amount.toString(), msg: JSON.stringify(msg) },
    { deposit: 1n },
  );
  if (sent.failedOn.includes(receiver)) throw new Error(`${receiver} refused the payment (${sent.tx})`);
  return sent;
}

export function deploymentPath(net: Network = network()) {
  return join(ROOT, "deployments", `${net}.json`);
}

export function loadDeployment(net: Network = network()): Deployment {
  const path = deploymentPath(net);
  if (!existsSync(path)) throw new Error(`No deployment at ${path}. Run the deploy script first.`);
  return JSON.parse(readFileSync(path, "utf8")) as Deployment;
}

export function saveDeployment(deployment: Deployment) {
  const path = deploymentPath(deployment.network);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(deployment, null, 2)}\n`);
}

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const explorerTx = (hash: string, net: Network = network()) =>
  net === "testnet" ? `https://testnet.nearblocks.io/txns/${hash}` : `https://nearblocks.io/txns/${hash}`;

/** The service definition every Sentinel business starts from. */
export function sentinelService(d: Deployment, overrides: Record<string, unknown> = {}) {
  if (!d.sentinel) throw new Error("Publish the agent first: npm run publish-agent");
  const vendor = d.sentinel.vendor;
  return {
    wasm: { url: d.sentinel.url, hash: d.sentinel.hash, build_target: d.sentinel.buildTarget },
    price: (USD / 4n).toString(),
    max_instructions: 10_000_000_000,
    max_memory_mb: 128,
    max_execution_seconds: 60,
    compute_deposit: (10n ** 22n * 2n).toString(), // 0.02 NEAR, unused part refunded
    secrets_profile: null,
    policy: {
      vendors: vendor ? [vendor] : [],
      max_per_tx: (USD / 10n).toString(),
      max_per_day: (USD * 5n).toString(),
    },
    ...overrides,
  };
}
