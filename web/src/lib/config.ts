import testnet from "../../../deployments/testnet.json";

export type Network = "testnet" | "mainnet";

type Deployment = {
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

const deployments: Partial<Record<Network, Deployment>> = { testnet: testnet as Deployment };

export const NETWORK: Network = process.env.NEXT_PUBLIC_NETWORK === "mainnet" ? "mainnet" : "testnet";

const active = deployments[NETWORK];
if (!active) throw new Error(`Lien has no deployment on ${NETWORK} yet.`);
export const deployment: Deployment = active;

export const isTestnet = NETWORK === "testnet";

export const RPC_URLS: Record<Network, string[]> = {
  // Four independent providers from NEAR's provider list, so one free tier throttling us
  // never stalls the app. (rpc.testnet.near.org and rpc.mainnet.near.org are retired.)
  testnet: ["https://rpc.testnet.fastnear.com", "https://testnet-rpc.intea.rs", "https://near-testnet.drpc.org", "https://api.zan.top/near-testnet", "https://test.rpc.fastnear.com"],
  mainnet: ["https://free.rpc.fastnear.com", "https://rpc.intea.rs", "https://near.drpc.org", "https://api.zan.top/near-mainnet"],
};

export const OUTLAYER_API = isTestnet ? "https://testnet-api.outlayer.ai" : "https://api.outlayer.ai";
export const EXPLORER = isTestnet ? "https://testnet.nearblocks.io" : "https://nearblocks.io";
export const REPO_URL = "https://github.com/Oshioke-Salaki/lien";

export const txUrl = (hash: string) => `${EXPLORER}/txns/${hash}`;
export const accountUrl = (id: string) => `${EXPLORER}/address/${id}`;
export const attestationUrl = (tx: string) => `${OUTLAYER_API}/attestations/by-tx/${tx}`;

/** NEAR needed to create a business: storage plus a starting compute tank. */
export const CREATE_DEPOSIT_NEAR = "0.5";
