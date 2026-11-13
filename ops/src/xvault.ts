// Chain Signatures vault for a Lien business: revenue held on Base Sepolia that
// can only move to one fixed settlement address.
//
//   npx tsx src/xvault.ts address           derive the vault's EVM address, check it against the signer
//   npx tsx src/xvault.ts deploy            create the keyless vault account (testnet only)
//   npx tsx src/xvault.ts send [wei]        ask the vault to sign a transfer, then broadcast it
//   npx tsx src/xvault.ts sign [wei]        only sign (works before the vault holds ETH); saves the raw tx
//   npx tsx src/xvault.ts broadcast         broadcast the saved signed transaction
//   npx tsx src/xvault.ts refuse            ask for a transfer to another address; NEAR refuses it
//
// Testnet only. No EVM private key exists anywhere: the vault's address and the
// settlement address are both Chain Signatures addresses.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { actions, nearToYocto, teraToGas, type Account } from "near-api-js";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { sha3_256, keccak_256 } from "@noble/hashes/sha3.js";
import { ROOT, account, view, explorerTx, sleep } from "./lib.js";

const NET = "testnet" as const;
if ((process.env.LIEN_NETWORK ?? "testnet") !== "testnet") throw new Error("xvault runs on testnet only");

const MPC = "v1.signer-prod.testnet";
const CHAIN_ID = 84532;
const EVM_RPC = process.env.BASE_SEPOLIA_RPC ?? "https://sepolia.base.org";
const EVM_EXPLORER = "https://sepolia.basescan.org/tx/";
/** The account that creates the vault as its sub-account. It pays for the vault's storage. */
const PARENT = "v1.lien-13569.testnet";
const VAULT = process.env.XVAULT_ID ?? `sentinel-x.${PARENT}`;
const BUSINESS = "sentinel.v1.lien-13569.testnet";
/** Who calls sign_transfer: anyone can; this account pays the NEAR gas and the 1 yoctoNEAR fee. */
const CALLER = process.env.XVAULT_CALLER ?? "lien-f2-3840.testnet";
/**
 * The settlement address: the Chain Signatures address of the Lien team account
 * `lien-13569.testnet` on path `lien-settlement-1`. It stands in for the off-ramp
 * that would bring the money into the business's NEAR inbox. The vault can pay
 * nobody else; what happens after the settlement address is outside the vault.
 */
const SETTLEMENT_OWNER = "lien-13569.testnet";
const SETTLEMENT_PATH = "lien-settlement-1";
/** 2 gwei: far above Base Sepolia's usual fees, so a stranger can waste at most 21000 * 2 gwei per signature. */
const FEE_CAP = 2_000_000_000n;
const VAULT_BALANCE = process.env.XVAULT_NEAR ?? "1.32";
const RECORD = join(ROOT, "deployments", "xvault-testnet.json");
const WASM = join(ROOT, "target", "near", "lien_xvault", "lien_xvault.wasm");

// ---------- hex, base58, RLP ----------

const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");
const unhex = (s: string) => Uint8Array.from(Buffer.from(s.replace(/^0x/, ""), "hex"));
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function unbase58(s: string): Uint8Array {
  let n = 0n;
  for (const c of s) {
    const i = B58.indexOf(c);
    if (i < 0) throw new Error(`bad base58: ${s}`);
    n = n * 58n + BigInt(i);
  }
  const bytes: number[] = [];
  while (n > 0n) {
    bytes.unshift(Number(n & 0xffn));
    n >>= 8n;
  }
  for (const c of s) {
    if (c !== "1") break;
    bytes.unshift(0);
  }
  return Uint8Array.from(bytes);
}

type Rlp = Uint8Array | Rlp[];
const num = (n: bigint | number) => {
  let v = BigInt(n);
  const out: number[] = [];
  while (v > 0n) {
    out.unshift(Number(v & 0xffn));
    v >>= 8n;
  }
  return Uint8Array.from(out);
};
function length(len: number, offset: number): Uint8Array {
  if (len < 56) return Uint8Array.of(offset + len);
  const l = num(len);
  return Uint8Array.of(offset + 55 + l.length, ...l);
}
function rlp(item: Rlp): Uint8Array {
  if (item instanceof Uint8Array) {
    if (item.length === 1 && item[0]! < 0x80) return item;
    return Uint8Array.from([...length(item.length, 0x80), ...item]);
  }
  const body = item.flatMap((i) => [...rlp(i)]);
  return Uint8Array.from([...length(body.length, 0xc0), ...body]);
}

// ---------- Chain Signatures derivation ----------

/** "secp256k1:<base58 of 64 bytes>" to a point. */
function point(key: string) {
  const [curve, body] = key.split(":");
  if (curve !== "secp256k1" || !body) throw new Error(`not a secp256k1 key: ${key}`);
  return secp256k1.Point.fromBytes(Uint8Array.of(4, ...unbase58(body)));
}

const evmAddress = (p: ReturnType<typeof point>) => `0x${hex(keccak_256(p.toBytes(false).slice(1)).slice(12))}`;

/**
 * The standard Chain Signatures derivation: epsilon = sha3_256(prefix + predecessor + "," + path),
 * derived key = root + epsilon * G.
 */
function derive(root: ReturnType<typeof point>, predecessor: string, path: string) {
  const epsilon = BigInt(`0x${hex(sha3_256(new TextEncoder().encode(`near-mpc-recovery v0.1.0 epsilon derivation:${predecessor},${path}`)))}`);
  return root.add(secp256k1.Point.BASE.multiply(epsilon));
}

async function addresses() {
  const root = point(await view<string>(MPC, "public_key", { domain_id: 0 }, NET));
  const out: Record<string, string> = {};
  for (const [name, predecessor, path] of [
    ["vault", VAULT, "evm-1"],
    ["settlement", SETTLEMENT_OWNER, SETTLEMENT_PATH],
  ] as const) {
    const local = derive(root, predecessor, path);
    const fromSigner = point(await view<string>(MPC, "derived_public_key", { path, predecessor, domain_id: 0 }, NET));
    if (!local.equals(fromSigner)) throw new Error(`${name}: local derivation does not match ${MPC}.derived_public_key`);
    out[name] = evmAddress(local);
    console.log(`${name}: ${out[name]} (${predecessor}, path "${path}"; matches ${MPC}.derived_public_key)`);
  }
  return { vault: out.vault!, settlement: out.settlement! };
}

// ---------- Base Sepolia ----------

async function evm<T = string>(method: string, params: unknown[] = []): Promise<T> {
  const res = await fetch(EVM_RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const body = (await res.json()) as { result?: T; error?: { message: string } };
  if (body.error) throw new Error(`${method}: ${body.error.message}`);
  return body.result as T;
}

// ---------- NEAR ----------

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
  const { settlement } = await addresses();
  const code = readFileSync(WASM);
  console.log(`Creating ${VAULT} with ${VAULT_BALANCE} NEAR for ${code.length} bytes of code, no access key`);
  const parent = account(PARENT, NET);
  // One transaction: create, fund, deploy, init. No AddKey action, so the account never has a key.
  const out = await send(parent, VAULT, [
    actions.createAccount(),
    actions.transfer(nearToYocto(VAULT_BALANCE as `${number}`)),
    actions.deployContract(code),
    actions.functionCall(
      "new",
      { business: BUSINESS, mpc: MPC, recipient: settlement, token: null, max_fee_per_gas_cap: FEE_CAP.toString() },
      teraToGas(30),
      0n,
    ),
  ]);
  if (out.failure) throw new Error(`deploy failed (${out.hash}): ${JSON.stringify(out.failure)}`);
  const keys = await keyCount(VAULT);
  console.log(`created ${explorerTx(out.hash, NET)}; access keys on ${VAULT}: ${keys}`);
  if (keys !== 0) throw new Error("the vault has an access key");
  save({ vault: VAULT, business: BUSINESS, mpc: MPC, path: "evm-1", settlementOwner: SETTLEMENT_OWNER, settlementPath: SETTLEMENT_PATH, settlement, createTx: out.hash, codeBytes: code.length });
}

type Big = { affine_point: string };
type MpcSignature = { big_r: Big; s: { scalar: string }; recovery_id: number; scheme?: string };

async function broadcast(raw: string) {
  const evmHash = await evm("eth_sendRawTransaction", [raw]);
  console.log(`broadcast ${EVM_EXPLORER}${evmHash}`);
  let receipt: { status: string; blockNumber: string } | null = null;
  for (let i = 0; i < 30 && !receipt; i++) {
    await sleep(2000);
    receipt = await evm<{ status: string; blockNumber: string } | null>("eth_getTransactionReceipt", [evmHash]);
  }
  if (!receipt) throw new Error("no receipt after a minute");
  console.log(`confirmed in block ${BigInt(receipt.blockNumber)}, status ${receipt.status}`);
  save({ evmTx: evmHash, evmBlock: Number(BigInt(receipt.blockNumber)), evmStatus: receipt.status });
}

/** `send` signs and broadcasts; `sign` only signs (for when the vault has no ETH yet) and saves the raw transaction. */
async function sendTransfer(mode: "send" | "sign", amountArg?: string) {
  const { vault, settlement } = await addresses();
  const policy = await view<{ recipient: string; chain_id: number }>(VAULT, "policy", {}, NET);
  if (policy.recipient !== settlement) throw new Error(`vault recipient ${policy.recipient} is not ${settlement}`);

  const [nonceHex, balanceHex, block, tipHex] = await Promise.all([
    evm("eth_getTransactionCount", [vault, "pending"]),
    evm("eth_getBalance", [vault, "latest"]),
    evm<{ baseFeePerGas: string }>("eth_getBlockByNumber", ["latest", false]),
    evm("eth_maxPriorityFeePerGas"),
  ]);
  const nonce = BigInt(nonceHex);
  const balance = BigInt(balanceHex);
  const tip = BigInt(tipHex) || 1_000_000n;
  // At least 0.05 gwei, so a transaction signed now still lands if fees rise before it is broadcast.
  let maxFee = BigInt(block.baseFeePerGas) * 2n + tip;
  if (maxFee < 50_000_000n) maxFee = 50_000_000n;
  if (maxFee > FEE_CAP) maxFee = FEE_CAP;
  const amount = BigInt(amountArg ?? "10000000000000"); // 0.00001 ETH
  // Base adds an L1 data fee on top of 21000 * maxFee; keep a margin for it.
  const needed = amount + 21000n * maxFee + 50_000_000_000_000n;
  console.log(`vault ${vault} holds ${balance} wei on Base Sepolia; this transfer needs about ${needed} wei`);
  if (balance < needed) {
    console.log(`the vault needs at least ${needed - balance} wei (${Number(needed - balance) / 1e18} ETH) more Base Sepolia ETH at ${vault}`);
    if (mode === "send") {
      console.log("STOP: not signing. Fund the vault, or run `sign` to get the MPC signature now and `broadcast` later.");
      process.exitCode = 2;
      return;
    }
  }

  const request = {
    chain_id: CHAIN_ID,
    to: settlement,
    amount: amount.toString(),
    nonce: Number(nonce),
    max_fee_per_gas: maxFee.toString(),
    max_priority_fee_per_gas: (tip > maxFee ? maxFee : tip).toString(),
  };
  const built = await view<{ payload: string; unsigned_tx: string }>(VAULT, "build_transfer", { request }, NET);

  // Rebuild the same transaction here, independently, and require the contract's bytes to match.
  const fields: Rlp[] = [num(CHAIN_ID), num(nonce), num(BigInt(request.max_priority_fee_per_gas)), num(maxFee), num(21000), unhex(settlement), num(amount), new Uint8Array(), []];
  const unsigned = Uint8Array.of(2, ...rlp(fields));
  if (`0x${hex(unsigned)}` !== built.unsigned_tx) throw new Error(`contract built ${built.unsigned_tx}, expected 0x${hex(unsigned)}`);
  const payload = keccak_256(unsigned);
  if (`0x${hex(payload)}` !== built.payload) throw new Error("payload mismatch");

  console.log(`asking ${VAULT} to sign nonce ${nonce}, ${amount} wei to ${settlement}`);
  const out = await send(account(CALLER, NET), VAULT, [actions.functionCall("sign_transfer", { request }, teraToGas(300), 1n)]);
  if (out.failure) throw new Error(`sign_transfer failed (${out.hash}): ${JSON.stringify(out.failure)}`);
  console.log(`NEAR tx ${explorerTx(out.hash, NET)}`);
  const sig = out.value as MpcSignature;
  const rBytes = unhex(sig.big_r.affine_point).slice(1);
  const sBytes = unhex(sig.s.scalar);
  const signature = new secp256k1.Signature(BigInt(`0x${hex(rBytes)}`), BigInt(`0x${hex(sBytes)}`), sig.recovery_id);
  const signer = evmAddress(signature.recoverPublicKey(payload));
  if (signer !== vault) throw new Error(`signature recovers to ${signer}, not the vault ${vault}`);

  console.log(`the MPC signature recovers to the vault address ${vault}`);

  const signed = `0x${hex(Uint8Array.of(2, ...rlp([...fields, num(sig.recovery_id), num(signature.r), num(signature.s)])))}`;
  // The signed transaction is public data, not a secret: it can only pay the settlement address.
  save({ signTx: out.hash, payload: built.payload, signedTx: signed, amountWei: amount.toString(), evmNonce: Number(nonce), maxFeePerGas: maxFee.toString() });
  if (mode === "send") await broadcast(signed);
  else console.log("signed, not broadcast. When the vault has ETH: npx tsx src/xvault.ts broadcast");
}

async function refuse() {
  const { settlement } = await addresses();
  const other = "0x000000000000000000000000000000000000dead";
  console.log(`asking ${VAULT} to sign a transfer to ${other} instead of ${settlement}`);
  const request = { chain_id: CHAIN_ID, to: other, amount: "1", nonce: 0, max_fee_per_gas: "1000000", max_priority_fee_per_gas: "1000000" };
  const out = await send(account(CALLER, NET), VAULT, [actions.functionCall("sign_transfer", { request }, teraToGas(50), 1n)]);
  if (!out.failure) throw new Error(`it was not refused: ${out.hash}`);
  console.log(`refused on NEAR ${explorerTx(out.hash, NET)}: ${JSON.stringify(out.failure)}`);
  save({ refuseTx: out.hash });
}

const [command, arg] = process.argv.slice(2);
if (command === "address") await addresses();
else if (command === "deploy") await deploy();
else if (command === "send" || command === "sign") await sendTransfer(command, arg);
else if (command === "broadcast") {
  const raw = record().signedTx;
  if (typeof raw !== "string") throw new Error("nothing signed yet: run sign first");
  await broadcast(raw);
} else if (command === "refuse") await refuse();
else console.log("usage: tsx src/xvault.ts address | deploy | send [wei] | sign [wei] | broadcast | refuse");
