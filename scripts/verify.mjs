#!/usr/bin/env node
// Checks Lien's core claims against live NEAR testnet, reading only public data.
// No wallet, no keys, no transactions, no money: every call is a read.
//
//   node scripts/verify.mjs            (or `npm run verify` here or in web/)
//   node scripts/verify.mjs <business> (any business account; Sentinel by default)
//
// The RPC providers are read from web/src/lib/config.ts and the addresses from
// deployments/testnet.json, so this checks the same deployment the app shows.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const deployment = JSON.parse(readFileSync(join(ROOT, "deployments/testnet.json"), "utf8"));
const config = readFileSync(join(ROOT, "web/src/lib/config.ts"), "utf8");
const RPCS = [...(config.match(/testnet:\s*\[([^\]]+)\]/)?.[1] ?? "").matchAll(/"([^"]+)"/g)].map((m) => m[1]);
if (!RPCS.length) throw new Error("Could not read the testnet RPC list from web/src/lib/config.ts");

const OUTLAYER_API = "https://testnet-api.outlayer.ai";
const TX_API = "https://tx.test.fastnear.com";
const EXPLORER = "https://testnet.nearblocks.io";
const business = process.argv[2] ?? `sentinel.${deployment.registry}`;

async function fetchWithTimeout(url, init = {}, ms = 15_000) {
  return fetch(url, { ...init, signal: AbortSignal.timeout(ms) });
}

/** One RPC query, tried against each provider in turn until one answers. */
async function query(params) {
  let last;
  for (const url of RPCS) {
    try {
      const response = await fetchWithTimeout(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: "verify", method: "query", params: { finality: "final", ...params } }),
      });
      const body = await response.json();
      if (body.result && !body.result.error) return body.result;
      last = new Error(JSON.stringify(body.error ?? body.result?.error ?? body));
    } catch (error) {
      last = error;
    }
  }
  throw last ?? new Error("No RPC provider answered");
}

async function view(account, method, args = {}) {
  const result = await query({ request_type: "call_function", account_id: account, method_name: method, args_base64: Buffer.from(JSON.stringify(args)).toString("base64") });
  return JSON.parse(Buffer.from(result.result).toString("utf8"));
}

const results = [];
async function check(title, run) {
  try {
    const { ok, detail } = await run();
    results.push(ok);
    console.log(`${ok ? "✅" : "❌"} ${title}\n   ${detail}`);
  } catch (error) {
    results.push(false);
    console.log(`❌ ${title}\n   could not check: ${error instanceof Error ? error.message : String(error)}`);
  }
}

console.log(`Lien verify: read-only checks against NEAR testnet`);
console.log(`Business: ${business}`);
console.log(`Registry: ${deployment.registry} · RPC: ${RPCS.length} providers from web/src/lib/config.ts\n`);

const agent = await view(business, "get_agent");

await check("The business account has zero access keys", async () => {
  const [own, inbox] = await Promise.all([
    query({ request_type: "view_access_key_list", account_id: business }),
    agent.collector ? query({ request_type: "view_access_key_list", account_id: agent.collector }) : Promise.resolve(null),
  ]);
  const ownKeys = own.keys.length;
  const inboxKeys = inbox ? inbox.keys.length : 0;
  return {
    ok: ownKeys === 0 && inboxKeys === 0,
    detail: `${business}: ${ownKeys} keys${inbox ? `; its inbox ${agent.collector}: ${inboxKeys} keys` : ""}`,
  };
});

await check("The deployed contract is the published Lien contract", async () => {
  const account = await query({ request_type: "view_account", account_id: business });
  const hash = account.global_contract_hash ?? account.code_hash;
  return { ok: hash === deployment.agentCode, detail: `on chain ${hash}, published ${deployment.agentCode} (deployments/testnet.json)` };
});

await check("The pinned agent build is the published build, byte for byte", async () => {
  const pinned = agent.service.wasm.hash;
  const response = await fetchWithTimeout(agent.service.wasm.url, {}, 60_000);
  if (!response.ok) return { ok: false, detail: `the build at ${agent.service.wasm.url} answered ${response.status}` };
  const bytes = Buffer.from(await response.arrayBuffer());
  const actual = createHash("sha256").update(bytes).digest("hex");
  const published = deployment.sentinel?.hash;
  const ok = actual === pinned && (!business.startsWith("sentinel.") || pinned === published);
  return { ok, detail: `pinned on chain ${pinned}; ${bytes.length.toLocaleString("en-US")} bytes from FastFS hash to ${actual}${published ? `; published ${published}` : ""}` };
});

await check("The books balance: tokens held cover every recorded obligation", async () => {
  const held = BigInt(await view(deployment.token, "ft_balance_of", { account_id: business }));
  const l = agent.ledger;
  const owed = [l.opex, l.operator, l.lender_pool, l.funding_escrow, l.job_escrow, l.auction_escrow, l.credits].reduce((sum, v) => sum + BigInt(v), 0n);
  const fmt = (v) => `${(Number(v) / 10 ** deployment.tokenDecimals).toFixed(2)} ${deployment.tokenSymbol}`;
  const relation = held === owed ? "equal" : held > owed ? `held exceeds the ledger by ${fmt(held - owed)} (plain transfers the contract never recorded)` : "HELD IS BELOW THE LEDGER";
  return { ok: held >= owed, detail: `held ${fmt(held)}, ledger total ${fmt(owed)}: ${relation}` };
});

await check("The latest Intel TDX attestation exists and names the pinned build", async () => {
  const response = await fetchWithTimeout(`${TX_API}/v0/account`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ account_id: business }),
  });
  const { account_txs: txs = [] } = await response.json();
  const newest = [...txs].sort((a, b) => b.tx_block_height - a.tx_block_height).slice(0, 20);
  for (const tx of newest) {
    const found = await fetchWithTimeout(`${OUTLAYER_API}/attestations/by-tx/${tx.transaction_hash}`).catch(() => null);
    if (!found?.ok) continue;
    const a = await found.json().catch(() => null);
    if (!a?.tdx_quote) continue;
    const ok = a.executed_wasm_sha256 === agent.service.wasm.hash;
    const when = a.timestamp ? new Date((a.timestamp > 1e12 ? a.timestamp : a.timestamp * 1000)).toISOString() : "unknown time";
    return {
      ok,
      detail: `quote of ${a.tdx_quote.length.toLocaleString("en-US")} chars, ${when}, ran ${a.executed_wasm_sha256}${ok ? " (the pinned build)" : ` but the pinned build is ${agent.service.wasm.hash}`}\n   ${EXPLORER}/txns/${tx.transaction_hash}`,
    };
  }
  return { ok: false, detail: `no attestation among the ${newest.length} newest transactions` };
});

await check("Robbing it during a loan was refused on chain (owner and stranger, read back from the chain)", async () => {
  const rec = JSON.parse(readFileSync(join(ROOT, "docs/evidence/refusals-testnet.json"), "utf8"));
  const lines = [];
  let ok = rec.attempts.length > 0;
  for (const a of rec.attempts) {
    let status = null;
    for (const url of RPCS) {
      try {
        const r = await fetchWithTimeout(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: "verify", method: "tx", params: { tx_hash: a.tx, sender_account_id: a.by, wait_until: "NONE" } }) });
        const body = await r.json();
        if (body.result?.status) { status = body.result.status; break; }
      } catch {}
    }
    const failed = Boolean(status && status.Failure);
    const text = status ? JSON.stringify(status.Failure ?? {}) : "";
    const reasonOk = failed && text.includes(a.reason);
    ok = ok && reasonOk;
    lines.push(`${reasonOk ? "refused" : "NOT CONFIRMED"}: ${a.what} ("${a.reason}") ${EXPLORER}/txns/${a.tx}`);
  }
  return { ok, detail: lines.join("\n   ") };
});

await check("A compromised build's payment outside the spend policy was blocked on chain", async () => {
  const rec = JSON.parse(readFileSync(join(ROOT, "docs/evidence/blocked-spend-testnet.json"), "utf8"));
  const a = await view(rec.business, "get_agent");
  const blocked = Number(a.stats?.spends_blocked ?? 0);
  return { ok: blocked >= 1, detail: `${rec.business}: spends_blocked = ${blocked} (read now from the chain); the build ${rec.compromised_build.hash.slice(0, 12)}… tried to pay ${rec.compromised_build.pays}\n   ${rec.transactions.buy_check?.link ?? ""}` };
});

const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} checks passed.`);
process.exit(passed === results.length ? 0 : 1);
