// Post-deploy smoke check against the live site: every main page answers, the APIs answer with
// the right shape, the MCP server lists its tools, and free accounts are available.
//   node scripts/smoke.mjs [https://lien-five.vercel.app]
const SITE = process.argv[2] ?? "https://lien-five.vercel.app";
const B = "sentinel.v1.lien-13569.testnet";
let failed = 0;
async function check(name, run) {
  try {
    const detail = await run();
    console.log(`✅ ${name}${detail ? `  (${detail})` : ""}`);
  } catch (e) {
    failed += 1;
    console.log(`❌ ${name}: ${e instanceof Error ? e.message : e}`);
  }
}
const get = async (path) => {
  const r = await fetch(SITE + path, { signal: AbortSignal.timeout(45_000), redirect: "follow" });
  if (!r.ok) throw new Error(`${path} answered ${r.status}`);
  return r;
};

for (const path of ["/", "/market", "/proof", "/guide", "/create", "/portfolio", `/b/${B}`, `/b/${B}/books`, "/llms.txt"]) {
  await check(`page ${path}`, async () => { await get(path); });
}
await check("404 page answers 404", async () => {
  const r = await fetch(SITE + "/no-such-page-xyz", { signal: AbortSignal.timeout(30_000) });
  if (r.status !== 404) throw new Error(`answered ${r.status}`);
});
await check("/api/market lists businesses", async () => {
  const d = await (await get("/api/market")).json();
  if (!Array.isArray(d.businesses) || d.businesses.length === 0) throw new Error("no businesses");
  return `${d.businesses.length} businesses`;
});
await check("/api/agents answers", async () => { await (await get("/api/agents")).json(); });
await check("free accounts available", async () => {
  const d = await (await get("/api/guest")).json();
  if (!d.available) throw new Error("sponsor paused");
  return `${d.accounts} accounts left`;
});
await check("MCP lists its tools", async () => {
  const r = await fetch(SITE + "/api/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    signal: AbortSignal.timeout(45_000),
  });
  const text = await r.text();
  const body = JSON.parse(text.slice(text.indexOf("{")));
  const n = body.result?.tools?.length ?? 0;
  if (n < 10) throw new Error(`only ${n} tools`);
  return `${n} tools`;
});
await check("an Intents quote route answers", async () => { await get("/api/quote"); });
await check("a business's books balance", async () => {
  const d = await (await get(`/api/books/${B}`)).json();
  if (!d.balance) throw new Error("no balance sheet");
  return `block ${d.block?.height ?? d.block}`;
});
await check("the Agent Market webhook refuses an unsigned call", async () => {
  const r = await fetch(SITE + "/api/agent-market/webhook", { method: "POST", body: "{}", signal: AbortSignal.timeout(30_000) });
  if (r.status !== 401) throw new Error(`answered ${r.status}`);
});

console.log(failed ? `\n${failed} check(s) failed` : "\nAll smoke checks passed.");
process.exit(failed ? 1 : 0);
