// One real NEAR Intents payment, settled on testnet into a Lien business inbox, through
// NEAR's own Intents verifier contract (the `defuse` contract that runs at intents.near).
//
// The verifier code is not built or changed here. It is read from mainnet intents.near
// (view_code), and its hash must equal the pinned hash below before it is deployed; a
// WASM=path override (for example a reproducible build of the same commit) must hash the
// same. The verifier account is created with no access key and no admin roles, so
// nobody can upgrade, pause or change it.
//
//   npx tsx src/intents-settle.ts deploy   create the keyless verifier account (testnet only), register it with tUSD
//   npx tsx src/intents-settle.ts settle   deposit, sign, execute, forward, refuse; records the hashes
//   npx tsx src/intents-settle.ts          both (deploy is skipped when the verifier already runs the pinned code)
//
// Accounts (env): VERIFIER_PARENT pays for and creates the verifier; PAYER deposits and
// signs; RELAYER submits the signed intent (any account can, as solvers and 1Click do).

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import { KeyPair, actions, nearToYocto, teraToGas, type Account, type KeyPairString } from "near-api-js";
import base58 from "./base58.js";
import { ROOT, USD, account, explorerTx, loadDeployment, sleep, view } from "./lib.js";

const NET = "testnet" as const;
if ((process.env.LIEN_NETWORK ?? "testnet") !== "testnet") throw new Error("this settlement runs on testnet only");

const d = loadDeployment(NET);

/** The code behind mainnet intents.near: near/intents tag defuse/v0.4.5. */
export const UPSTREAM = {
  repo: "https://github.com/near/intents",
  tag: "defuse/v0.4.5",
  commit: "16d04f6ec4401263f8914638710260da50bb46b0",
  mainnetAccount: "intents.near",
  codeHash: "BtA1BEFNS619KkvXFsgcpQ21Tb5yMm32aaUkn7xNothk",
  sha256: "a1afab98916d9f213746544dcf8e4e6bdb22c0be6bc5dfbd8ea8814c9922b547",
};

const PARENT = process.env.VERIFIER_PARENT ?? "lien-intents-27984.testnet";
const VERIFIER = process.env.VERIFIER ?? `verifier.${PARENT}`;
const VERIFIER_NEAR = process.env.VERIFIER_NEAR ?? "14";
const FUNDER = process.env.FUNDER; // optional: tops up PARENT before the deploy
const FUNDER_NEAR = process.env.FUNDER_NEAR ?? "6";
const PAYER = process.env.PAYER ?? "lien-payer-27984.testnet";
const RELAYER = process.env.RELAYER ?? "lien-13569.testnet";
const BUSINESS = process.env.BUSINESS ?? `sentinel.${d.registry}`;
const AMOUNT = BigInt(process.env.AMOUNT ?? USD.toString()); // 1 tUSD
const DEPLOYMENT = join(ROOT, "deployments", "intents-testnet.json");
const EVIDENCE = join(ROOT, "docs", "evidence", "intents-settlement-testnet.json");
const TOKEN_STORAGE = 1_250_000_000_000_000_000_000n;

type Outcome = { hash: string; link: string; failure?: unknown; reason?: string; logs: string[]; failedReceipts: string[] };

async function rateLimited<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt >= 5 || !String(error).includes("-429")) throw error;
      await sleep(5_000 * (attempt + 1));
    }
  }
}

async function sendActions(signer: Account, receiverId: string, acts: ReturnType<typeof actions.transfer>[]): Promise<Outcome> {
  const outcome = await rateLimited(() => signer.signAndSendTransaction({ receiverId, actions: acts, waitUntil: "FINAL", throwOnFailure: false }));
  const failure = (outcome.status as { Failure?: unknown }).Failure;
  const text = failure ? JSON.stringify(failure) : "";
  const receipts = outcome.receipts_outcome ?? [];
  return {
    hash: outcome.transaction.hash,
    link: explorerTx(outcome.transaction.hash, NET),
    failure,
    reason: failure ? (text.match(/Smart contract panicked: ([^"\\]+)/)?.[1] ?? text.slice(0, 200)) : undefined,
    logs: receipts.flatMap((r) => r.outcome.logs),
    failedReceipts: receipts
      .filter((r) => (r.outcome.status as { Failure?: unknown }).Failure)
      .map((r) => `${r.outcome.executor_id}: ${JSON.stringify((r.outcome.status as { Failure?: unknown }).Failure).slice(0, 200)}`),
  };
}

const send = (signer: Account, receiverId: string, method: string, args: object, deposit = 0n, tgas = 300) =>
  sendActions(signer, receiverId, [actions.functionCall(method, args as Record<string, unknown>, teraToGas(tgas), deposit)]);

function must(o: Outcome, what: string): Outcome {
  if (o.failure || o.failedReceipts.length) throw new Error(`${what} failed (${o.link}): ${o.reason ?? o.failedReceipts.join("; ")}`);
  return o;
}

async function rpc(url: string, method: string, params: object) {
  const body = await rateLimited(async () => {
    const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
    const b = (await r.json()) as { result?: any; error?: unknown };
    if (r.status === 429) throw new Error("-429");
    return b;
  });
  if (!body.result) throw new Error(`${method}: ${JSON.stringify(body.error)}`);
  return body.result;
}

const viewAccount = (id: string) =>
  rpc("https://rpc.testnet.fastnear.com", "query", { request_type: "view_account", finality: "final", account_id: id }).catch(() => null);

/** The verifier wasm: mainnet intents.near's code (or WASM=path), checked against the pinned hash. */
async function upstreamWasm(): Promise<Buffer> {
  let code: Buffer;
  if (process.env.WASM) {
    code = readFileSync(process.env.WASM);
  } else {
    const r = await rpc("https://free.rpc.fastnear.com", "query", { request_type: "view_code", finality: "final", account_id: UPSTREAM.mainnetAccount });
    code = Buffer.from(r.code_base64, "base64");
  }
  const sha = createHash("sha256").update(code).digest();
  const hash = base58(sha);
  if (hash !== UPSTREAM.codeHash) throw new Error(`the wasm hashes to ${hash}, not the pinned ${UPSTREAM.codeHash}; refusing to deploy it`);
  return code;
}

async function deploy() {
  const existing = await viewAccount(VERIFIER);
  if (existing) {
    if (existing.code_hash !== UPSTREAM.codeHash) throw new Error(`${VERIFIER} exists with code ${existing.code_hash}, not ${UPSTREAM.codeHash}`);
    console.log(`ATTACH   ${VERIFIER} already runs ${UPSTREAM.codeHash}`);
    return;
  }
  const code = await upstreamWasm();
  console.log(`WASM     ${code.length} bytes from ${process.env.WASM ?? UPSTREAM.mainnetAccount}, hash ${UPSTREAM.codeHash} (pinned)`);
  if (FUNDER) {
    const top = must(await sendActions(account(FUNDER, NET), PARENT, [actions.transfer(nearToYocto(FUNDER_NEAR as `${number}`))]), "top-up");
    console.log(`FUND     ${FUNDER} -> ${PARENT} ${FUNDER_NEAR} NEAR  ${top.link}`);
  }
  // No fee, no admins: nobody can pause, upgrade or reconfigure it. The account gets no access key.
  const config = { wnear_id: "wrap.testnet", fees: { fee: 0, fee_collector: VERIFIER }, roles: { super_admins: [], admins: {}, grantees: {} } };
  const created = must(
    await sendActions(account(PARENT, NET), VERIFIER, [
      actions.createAccount(),
      actions.transfer(nearToYocto(VERIFIER_NEAR as `${number}`)),
      actions.deployContract(new Uint8Array(code)),
      actions.functionCall("new", { config }, teraToGas(50), 0n),
    ]),
    "create verifier",
  );
  console.log(`DEPLOY   ${VERIFIER}  ${created.link}`);
  const keys = (await rpc("https://rpc.testnet.fastnear.com", "query", { request_type: "view_access_key_list", finality: "final", account_id: VERIFIER })).keys.length;
  const onChain = await viewAccount(VERIFIER);
  if (onChain?.code_hash !== UPSTREAM.codeHash) throw new Error(`deployed code hash ${onChain?.code_hash} != ${UPSTREAM.codeHash}`);
  // The verifier must hold a tUSD account to receive deposits.
  const reg = must(await send(account(PAYER, NET), d.token, "storage_deposit", { account_id: VERIFIER, registration_only: true }, TOKEN_STORAGE, 30), "register verifier");
  console.log(`REGISTER ${VERIFIER} on ${d.token}  ${reg.link}`);
  writeFileSync(
    DEPLOYMENT,
    `${JSON.stringify(
      {
        network: NET,
        what: "NEAR's Intents verifier (the defuse contract behind intents.near), deployed unmodified to a keyless testnet account. Intents has no official testnet deployment.",
        verifier: VERIFIER,
        source: { ...UPSTREAM, wasmBytes: code.length, wasmFrom: process.env.WASM ? "local file" : `view_code on mainnet ${UPSTREAM.mainnetAccount}` },
        codeHashOnChain: onChain.code_hash,
        accessKeys: keys,
        init: { method: "new", args: { config } },
        createTx: created.hash,
        tokenRegistrationTx: reg.hash,
        token: d.token,
        createdBy: PARENT,
        at: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
  );
  console.log(`SAVED    ${DEPLOYMENT}`);
}

// ---- NEP-413 signing -------------------------------------------------------

function keyPairOf(id: string): KeyPair {
  const path = join(homedir(), ".near-credentials", NET, `${id}.json`);
  const { private_key } = JSON.parse(readFileSync(path, "utf8")) as { private_key: KeyPairString };
  return KeyPair.fromString(private_key);
}

const u32 = (n: number) => {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n);
  return b;
};
const borshString = (s: string) => Buffer.concat([u32(Buffer.byteLength(s)), Buffer.from(s)]);

/** sha256(borsh(2^31 + 413, { message, nonce, recipient, callback_url: None })), per NEP-413. */
function nep413Hash(message: string, nonce: Buffer, recipient: string): Buffer {
  const bytes = Buffer.concat([u32(2 ** 31 + 413), borshString(message), nonce, borshString(recipient), Buffer.from([0])]);
  return createHash("sha256").update(bytes).digest();
}

/** A versioned (V1) nonce: magic prefix, version 0, the verifier's current salt, its own deadline, 15 random bytes. */
function versionedNonce(saltHex: string, deadline: Date): Buffer {
  const nanos = Buffer.alloc(8);
  nanos.writeBigInt64LE(BigInt(deadline.getTime()) * 1_000_000n);
  return Buffer.concat([Buffer.from("5628f6c6", "hex"), Buffer.from([0]), Buffer.from(saltHex, "hex"), nanos, randomBytes(15)]);
}

function signIntent(signer: KeyPair, signerId: string, intents: object[], deadline: Date, nonce: Buffer) {
  const message = JSON.stringify({ signer_id: signerId, deadline: deadline.toISOString(), intents });
  const hash = nep413Hash(message, nonce, VERIFIER);
  const { signature } = signer.sign(hash);
  return {
    standard: "nep413",
    payload: { message, nonce: nonce.toString("base64"), recipient: VERIFIER },
    public_key: signer.getPublicKey().toString(),
    signature: `ed25519:${base58(signature)}`,
  };
}

// ---- the settlement --------------------------------------------------------

const tokenId = `nep141:${d.token}`;
const usd = (v: bigint | string) => `${(Number(v) / 1e6).toFixed(2)} tUSD`;

async function settle() {
  const payer = account(PAYER, NET);
  const relayer = account(RELAYER, NET);
  const agent = await view<any>(BUSINESS, "get_agent", {}, NET);
  const inbox: string = agent.collector;
  if (!inbox) throw new Error(`${BUSINESS} has no inbox`);
  const steps: Record<string, Outcome> = {};

  // (a) The payer holds tUSD (test faucet) and deposits it into the verifier.
  const reg = await view<{ total: string } | null>(d.token, "storage_balance_of", { account_id: PAYER }, NET);
  if (!reg) steps.payerRegister = must(await send(payer, d.token, "storage_deposit", { account_id: PAYER, registration_only: true }, TOKEN_STORAGE, 30), "register payer");
  const held = BigInt(await view<string>(d.token, "ft_balance_of", { account_id: PAYER }, NET));
  if (held < AMOUNT) {
    steps.faucet = must(await send(payer, d.token, "faucet", { account_id: PAYER, amount: AMOUNT.toString() }, 0n, 30), "faucet");
    console.log(`FAUCET   ${PAYER} +${usd(AMOUNT)} test tUSD  ${steps.faucet.link}`);
  }
  steps.deposit = must(
    await send(payer, d.token, "ft_transfer_call", { receiver_id: VERIFIER, amount: AMOUNT.toString(), msg: "" }, 1n, 100),
    "deposit",
  );
  const inVerifier = BigInt(await view<string>(VERIFIER, "mt_balance_of", { account_id: PAYER, token_id: tokenId }, NET));
  console.log(`DEPOSIT  ${PAYER} -> ${VERIFIER} ${usd(AMOUNT)}; payer's balance inside the verifier: ${usd(inVerifier)}  ${steps.deposit.link}`);
  if (inVerifier < AMOUNT) throw new Error("the deposit did not credit the payer inside the verifier");

  // The payer registers its signing key with the verifier (a named account has no implicit key).
  const signer = keyPairOf(PAYER);
  const pk = signer.getPublicKey().toString();
  const hasKey = await view<boolean>(VERIFIER, "has_public_key", { account_id: PAYER, public_key: pk }, NET);
  if (!hasKey) {
    steps.addPublicKey = must(await send(payer, VERIFIER, "add_public_key", { public_key: pk }, 1n, 30), "add_public_key");
    console.log(`KEY      ${PAYER} registered ${pk}  ${steps.addPublicKey.link}`);
  }

  // (b) The payer signs one intent off chain: withdraw the tUSD to the business's inbox.
  const salt = await view<string>(VERIFIER, "current_salt", {}, NET);
  const deadline = new Date(Date.now() + 10 * 60_000);
  const intent = { intent: "ft_withdraw", token: d.token, receiver_id: inbox, amount: AMOUNT.toString(), memo: `Lien: an Intents payment to ${BUSINESS}` };
  const signed = signIntent(signer, PAYER, [intent], deadline, versionedNonce(salt, deadline));
  console.log(`SIGNED   NEP-413 by ${PAYER}: ft_withdraw ${usd(AMOUNT)} -> ${inbox}, deadline ${deadline.toISOString()}`);

  // Dry run against the verifier itself before sending (a view call, free).
  const sim = await view<any>(VERIFIER, "simulate_intents", { signed: [signed] }, NET);
  if (sim.invariant_violated) throw new Error(`simulation: ${JSON.stringify(sim.invariant_violated)}`);

  // (c) A different account, the relayer, submits it. The verifier checks the signature and nonce and pays out.
  const inboxBefore = BigInt(await view<string>(d.token, "ft_balance_of", { account_id: inbox }, NET));
  steps.execute = must(await send(relayer, VERIFIER, "execute_intents", { signed: [signed] }, 0n, 300), "execute_intents");
  const inboxAfter = BigInt(await view<string>(d.token, "ft_balance_of", { account_id: inbox }, NET));
  console.log(`EXECUTE  relayer ${RELAYER}; inbox ${inbox} ${usd(inboxBefore)} -> ${usd(inboxAfter)}  ${steps.execute.link}`);
  for (const log of steps.execute.logs) console.log(`         ${log}`);
  if (inboxAfter - inboxBefore < AMOUNT) throw new Error("the inbox did not receive the withdrawal");

  // Refusals: the same signed intent again (reused nonce), and the relayer rewriting it to pay itself.
  const replay = await send(relayer, VERIFIER, "execute_intents", { signed: [signed] }, 0n, 100);
  if (!replay.failure) throw new Error(`a replayed intent was accepted (${replay.link})`);
  console.log(`REFUSED  replay of the same signed intent: ${replay.reason}  ${replay.link}`);
  const forgedMessage = signed.payload.message.replace(inbox, RELAYER);
  const forged = { ...signed, payload: { ...signed.payload, message: forgedMessage } };
  const forge = await send(relayer, VERIFIER, "execute_intents", { signed: [forged] }, 0n, 100);
  if (!forge.failure) throw new Error(`a rewritten intent was accepted (${forge.link})`);
  console.log(`REFUSED  the relayer rewrote the receiver to itself: ${forge.reason}  ${forge.link}`);

  // (d) Anyone forwards the inbox into the business's lenders-first split.
  const before = await view<any>(BUSINESS, "get_agent", {}, NET);
  steps.forward = must(await send(relayer, inbox, "forward", {}, 0n, 200), "forward");
  const after = await view<any>(BUSINESS, "get_agent", {}, NET);
  const repaid = BigInt(after.current_loan?.repaid ?? 0) - BigInt(before.current_loan?.repaid ?? 0);
  const ext = BigInt(after.stats.external_revenue) - BigInt(before.stats.external_revenue);
  console.log(`FORWARD  ${inbox} -> ${BUSINESS}: external revenue +${usd(ext)}, lenders repaid +${usd(repaid)}  ${steps.forward.link}`);
  for (const log of steps.forward.logs) console.log(`         ${log}`);

  const row = (o: Outcome) => ({ tx: o.hash, link: o.link });
  writeFileSync(
    EVIDENCE,
    `${JSON.stringify(
      {
        what: "One NEAR Intents payment settled on testnet: a payer deposits tUSD into NEAR's unmodified Intents verifier, signs an ft_withdraw intent (NEP-413, ed25519) to Sentinel's inbox, a different account relays it with execute_intents, and the inbox is forwarded into the business's lenders-first split.",
        network: NET,
        at: new Date().toISOString(),
        verifier: VERIFIER,
        verifierCode: { codeHash: UPSTREAM.codeHash, repo: UPSTREAM.repo, tag: UPSTREAM.tag, commit: UPSTREAM.commit, sameAs: UPSTREAM.mainnetAccount },
        token: d.token,
        amount: AMOUNT.toString(),
        payer: PAYER,
        relayer: RELAYER,
        business: BUSINESS,
        inbox,
        signedIntent: signed,
        transactions: Object.fromEntries(Object.entries(steps).map(([k, v]) => [k, row(v)])),
        executeLogs: steps.execute.logs,
        inboxBalance: { before: inboxBefore.toString(), afterExecute: inboxAfter.toString() },
        forward: { externalRevenueAdded: ext.toString(), lendersRepaidAdded: repaid.toString(), logs: steps.forward.logs },
        refused: [
          { what: "The same signed intent submitted a second time (reused nonce)", by: RELAYER, reason: replay.reason, ...row(replay) },
          { what: "The relayer rewrote the signed intent to pay itself instead of the inbox", by: RELAYER, reason: forge.reason, ...row(forge) },
        ],
      },
      null,
      2,
    )}\n`,
  );
  console.log(`SAVED    ${EVIDENCE}`);
}

const cmd = process.argv[2] ?? "all";
if (cmd === "deploy" || cmd === "all") await deploy();
if (cmd === "settle" || cmd === "all") {
  if (!existsSync(DEPLOYMENT) && !(await viewAccount(VERIFIER))) throw new Error("deploy the verifier first");
  await settle();
}
