// The landing page's two live parts, with no framework:
// 1. the simulator, which runs the contract's own waterfall rule (web/src/lib/math.ts splitInflow);
// 2. the figures read from NEAR testnet. Every figure has a real fallback in the HTML, so a slow
//    or failed RPC leaves the page correct, only a little older. The hero's business and sales
//    counts grow, so they have no number fallback: until read, the hero says it in words.

const BPS = 10_000n;
const USD = 1_000_000n;

function splitInflow(amount, outstanding, lenderBps, operatorBps, trapped) {
  const [lenderShare, operatorShare] = trapped ? [BigInt(lenderBps) + BigInt(operatorBps), 0n] : [BigInt(lenderBps), BigInt(operatorBps)];
  const wanted = (amount * lenderShare) / BPS;
  const lender = wanted < outstanding ? wanted : outstanding;
  const operator = (amount * operatorShare) / BPS;
  return { lender, operator, opex: amount - lender - operator };
}

const dollars = (v) => `$${(v / USD).toLocaleString("en-US")}`;
const $ = (sel, root = document) => root.querySelector(sel);

function simulator() {
  const root = $("#try");
  if (!root) return;
  const PRINCIPAL = 1_000n * USD, TOTAL_DUE = 1_100n * USD, OPERATOR_BPS = 2_000, MONTHS = 3n;
  const revenue = $("#sim-revenue"), share = $("#sim-share"), bid = $("#sim-bid"), stop = $('[data-testid="sim-stop"]');
  const notice = $('[data-testid="notice"]');
  let stopped = false;

  const set = (sel, text) => { const el = $(sel, root); if (el) el.textContent = text; };
  const render = () => {
    const monthly = BigInt(revenue.value) * USD;
    const lenderBps = Number(share.value) * 100;
    const split = splitInflow(monthly, TOTAL_DUE, lenderBps, OPERATOR_BPS, false);
    // The lenders' share as set; the contract never takes more than is owed, so above the debt it stops there.
    const wanted = (monthly * BigInt(lenderBps)) / BPS;
    const capped = wanted > split.lender;
    const months = split.lender > 0n ? (TOTAL_DUE + split.lender - 1n) / split.lender : null;
    const paid = split.lender * MONTHS;
    const repaid = paid < TOTAL_DUE ? paid : TOTAL_DUE;
    const outstanding = TOTAL_DUE - repaid;
    const price = BigInt(bid.value) * USD;
    const toLenders = price < outstanding ? price : outstanding;
    const cleared = stopped && outstanding === 0n;
    const noticed = stopped && !cleared;

    set('[data-out="revenue"]', `$${Number(revenue.value).toLocaleString("en-US")}`);
    set('[data-out="share"]', `${share.value}%`);
    set('[data-out="bid"]', `$${Number(bid.value).toLocaleString("en-US")}`);
    set('[data-testid="monthly-lender"]', capped ? `${dollars(split.lender)}, the whole debt (${share.value}% would be ${dollars(wanted)})` : dollars(split.lender));
    set('[data-sim="operator"]', dollars(split.operator));
    set('[data-sim="opex"]', dollars(split.opex));
    set('[data-testid="payoff"]', months === null || months > 12n ? "Not within the 12-month term" : `${months} ${months === 1n ? "month" : "months"}`);
    set('[data-sim="repaid"]', dollars(repaid));
    set('[data-testid="still-owed"]', dollars(outstanding));
    set('[data-sim="price"]', dollars(price));
    set('[data-testid="recovered"]', dollars(repaid + toLenders));
    set('[data-sim="surplus"]', dollars(price - toLenders));
    const recovered = repaid + toLenders;
    set('[data-sim="shortfall"]', dollars(recovered < TOTAL_DUE ? TOTAL_DUE - recovered : 0n));

    notice.dataset.state = noticed ? "foreclosed" : "active";
    set('[data-sim="title"]', noticed ? "Notice of foreclosure" : cleared ? "Lien released" : "Record of lien");
    set('[data-sim="note"]', noticed
      ? "The address and the service stay exactly as they were. Only the owner changes."
      : cleared ? "The debt was repaid before sales stopped, so the lien is released: the owner keeps the business, and nothing more goes to lenders."
      : months === null || months > 12n ? "At this revenue the loan isn't repaid in its 12 months: at the end, anyone could take the business over."
      : "Current. Nobody holds a key to this business.");
    $('[data-sim="stamp"]', root).hidden = !noticed;
    $('[data-sim="running"]', root).hidden = noticed;
    $('[data-sim="stopped"]', root).hidden = !noticed;
    stop.setAttribute("aria-pressed", String(stopped));
    stop.textContent = stopped ? "Let its sales run again" : "Stop its sales after 3 months";
  };

  for (const input of [revenue, share]) input.addEventListener("input", render);
  bid.addEventListener("input", render);
  stop.addEventListener("click", () => { stopped = !stopped; render(); });
  render();
}

// ---- live figures ----
const REGISTRY = "v1.lien-13569.testnet";
const RPCS = ["https://rpc.testnet.fastnear.com", "https://testnet-rpc.intea.rs", "https://near-testnet.drpc.org", "https://api.zan.top/near-testnet", "https://test.rpc.fastnear.com"];

async function view(account, method, args = {}) {
  const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "query", params: { request_type: "call_function", finality: "optimistic", account_id: account, method_name: method, args_base64: btoa(JSON.stringify(args)) } });
  for (const url of RPCS) {
    try {
      const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body, signal: AbortSignal.timeout(8000) });
      const json = await res.json();
      if (json.result?.result) return JSON.parse(new TextDecoder().decode(new Uint8Array(json.result.result)));
    } catch { /* the next node */ }
  }
  throw new Error("unreachable");
}

// The app's one rounding rule (web/src/lib/format.ts): amounts round half up to the cent, what is
// still owed rounds UP, and what was repaid is the rounded total less what is owed, so the two
// always add up and match the app to the cent.
const cents = (v) => (BigInt(v) + 5_000n) / 10_000n; // half up, 6-decimal token to cents
const centsUp = (v) => (BigInt(v) + 9_999n) / 10_000n;
const fromCents = (c) => `${(c / 100n).toLocaleString("en-US")}.${String(c % 100n).padStart(2, "0")}`;
const tusd = (v) => fromCents(cents(v));
const owedUsd = (total, repaid) => { const left = BigInt(total) - BigInt(repaid); return fromCents(centsUp(left > 0n ? left : 0n)); };
const repaidUsd = (total, repaid) => { const left = BigInt(total) - BigInt(repaid); return fromCents(cents(total) - centsUp(left > 0n ? left : 0n)); };
const isTest = (id) => id.startsWith("e2e-") || id.startsWith("ui-");

async function live() {
  const set = (key, text) => { for (const el of document.querySelectorAll(`[data-live="${key}"]`)) el.textContent = text; };
  try {
    const ids = (await view(REGISTRY, "get_agents", { limit: 100 })).filter((id) => !isTest(id));
    set("count", String(ids.length));
    const all = await Promise.allSettled(ids.map((id) => view(id, "get_agent")));
    const jobs = all.reduce((n, r) => n + (r.status === "fulfilled" ? Number(r.value.stats.jobs_done) : 0), 0);
    set("jobs", String(jobs));
    // The counts are shown only once read: the same figures /api/market reports (businesses,
    // checksSold), never a stale number baked into the HTML.
    const counts = document.querySelector("[data-live-counts]");
    const fallback = document.querySelector("[data-live-fallback]");
    if (counts) counts.hidden = false;
    if (fallback) fallback.hidden = true;
    // When the latest sale happened, across the businesses: the market is live, so say so.
    const latest = await Promise.all(ids.map((id) => view(id, "get_jobs", { limit: 1 }).then((j) => Number(j[0]?.created_at ?? 0), () => 0)));
    const newest = Math.max(0, ...latest);
    if (newest) {
      const mins = Math.max(1, Math.round((Date.now() / 1000 - newest) / 60));
      set("last-sale", mins < 60 ? `${mins} min ago` : mins < 1440 ? `${Math.round(mins / 60)} h ago` : `${Math.round(mins / 1440)} d ago`);
      const holder = document.querySelector("[data-live-last]");
      if (holder) holder.hidden = false;
    }
    const sentinel = all[ids.indexOf(`sentinel.${REGISTRY}`)];
    const loan = sentinel?.status === "fulfilled" ? sentinel.value.current_loan : null;
    if (loan) {
      set("sentinel-repaid", repaidUsd(loan.terms.total_due, loan.repaid));
      set("sentinel-owed", owedUsd(loan.terms.total_due, loan.repaid));
      set("sentinel-holders", String(loan.holders));
      set("sentinel-state", loan.is_behind ? "Behind" : loan.status === "Active" ? "Paying on time" : loan.status);
      const bar = document.querySelector('[data-live-bar="sentinel"]');
      if (bar) bar.style.setProperty("--k", String(Number(loan.repaid) / Number(loan.terms.total_due)));
    }
    renderMarket(ids, all);
    const north = all[ids.indexOf(`sentinel-north.${REGISTRY}`)];
    const raise = north?.status === "fulfilled" ? north.value.current_loan : null;
    if (raise) {
      set("north-funded", tusd(raise.funded));
      set("north-holders", String(raise.holders));
      const bar = document.querySelector('[data-live-bar="north"]');
      if (bar) bar.style.setProperty("--k", String(Number(raise.funded) / Number(raise.terms.principal)));
    }
  } catch { /* the HTML figures stand */ }
}

const SAMPLE = /^(sentinel|lookout|watchtower|beacon)/;
// Only the samples the Lien team still runs (web/src/lib/demo.ts TEAM): not copies visitors made or bought.
const TEAM = new Set(["lien-f1-3833.testnet", "lien-f4-3863.testnet"]);
const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ESC[c]);

/** The market window shows the live sample businesses, each a link to its page. */
function renderMarket(ids, all) {
  const list = document.querySelector("[data-live-market]");
  if (!list) return;
  const rows = [];
  ids.forEach((id, i) => {
    const r = all[i];
    if (r.status !== "fulfilled" || !SAMPLE.test(id) || !TEAM.has(r.value.operator)) return;
    const a = r.value;
    const loan = a.current_loan;
    let state = "No loan", sub = "Sells safety checks", warn = false, rank = 5;
    if (loan && loan.status === "Funding") { state = "Raising"; sub = `$${tusd(loan.funded)} of $${tusd(loan.terms.principal)} raised`; rank = 1; }
    else if (loan && loan.status === "Active" && loan.foreclosable_at !== null && a.now >= loan.foreclosable_at) { state = "Can be taken over"; sub = `Missed payments, $${owedUsd(loan.terms.total_due, loan.repaid)} owed`; warn = true; rank = 0; }
    else if (loan && loan.status === "Active") { state = loan.is_behind ? "Behind" : "Paying on time"; sub = `$${repaidUsd(loan.terms.total_due, loan.repaid)} of $${tusd(loan.terms.total_due)} paid back`; warn = loan.is_behind; rank = 3; }
    else if (loan && loan.status === "Foreclosed") { state = "For sale"; sub = `Lowest bid $${fromCents(centsUp(loan.min_next_bid || "0"))}`; warn = true; rank = 2; }
    const sel = id.startsWith("sentinel-north.") ? ' class="is-sel"' : "";
    rows.push({ rank, name: a.name, html: `<li${sel}><a href="/b/${esc(id)}"><span class="mk__who"><b>${esc(a.name)}</b><span>${esc(sub)}</span></span><span class="ui-chip${warn ? " is-warn" : ""}">${esc(state)}</span></a></li>` });
  });
  // One row per name: two samples both called "Lookout" show once, the one most worth acting on.
  const seen = new Set();
  const unique = rows.sort((x, y) => x.rank - y.rank).filter((r) => (seen.has(r.name) ? false : (seen.add(r.name), true)));
  if (unique.length) list.innerHTML = unique.slice(0, 6).map((r) => r.html).join("");
}

simulator();
live();
