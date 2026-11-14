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
    const shortfall = recovered < TOTAL_DUE ? TOTAL_DUE - recovered : 0n;
    set('[data-sim="shortfall"]', dollars(shortfall));

    notice.dataset.state = noticed ? "foreclosed" : "active";
    set('[data-sim="title"]', noticed ? "Notice of foreclosure" : cleared ? "Lien released" : "Record of lien");
    set('[data-sim="note"]', noticed
      ? shortfall > 0n
        ? `Lenders took the business over and sold it. The winning bid covers ${dollars(toLenders)} of the ${dollars(outstanding)} still owed, so they lose ${dollars(shortfall)}. Move the bid to see the loss change.`
        : "Lenders took the business over and sold it, and the winning bid covers everything still owed. The address and the service stay as they were; only the owner changes."
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

const set = (key, text) => { for (const el of document.querySelectorAll(`[data-live="${key}"]`)) el.textContent = text; };
const bar = (key, k) => { const el = document.querySelector(`[data-live-bar="${key}"]`); if (el) el.style.setProperty("--k", String(Math.min(1, Math.max(0, k)))); };
const ago = (secs) => { const mins = Math.max(1, Math.round((Date.now() / 1000 - secs) / 60)); return mins < 60 ? `${mins} min ago` : mins < 1440 ? `${Math.round(mins / 60)} h ago` : `${Math.round(mins / 1440)} d ago`; };
const day = (secs) => new Date(secs * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

/** Sentinel, from the contract's own get_agent view, in the hero card. */
function showSamples(byId) {
  const loan = byId(`sentinel.${REGISTRY}`)?.current_loan;
  if (loan) {
    set("sentinel-repaid", repaidUsd(loan.terms.total_due, loan.repaid));
    set("sentinel-owed", owedUsd(loan.terms.total_due, loan.repaid));
    set("sentinel-total", tusd(loan.terms.total_due));
    set("sentinel-holders", String(loan.holders));
    set("sentinel-state", LABEL[standing({ current_loan: loan, now: byId(`sentinel.${REGISTRY}`).now })]);
    if (loan.maturity) set("sentinel-due", `Due ${day(loan.maturity)}`);
    bar("sentinel", Number(loan.repaid) / Number(loan.terms.total_due));
  }
}

/**
 * The business featured beside the market list: one that is raising right now, so its button
 * really does lend. Harbor (the team's always-open small loan) first, then any team business
 * that is raising, then any raising business. If nobody is raising, the button says so.
 */
function showPick(businesses) {
  const raising = businesses.filter((a) => a.current_loan?.status === "Funding" && a.now < a.current_loan.funding_deadline && BigInt(a.current_loan.funded) < BigInt(a.current_loan.terms.principal) && !PROBE.test(a.name));
  const pick = raising.find((a) => /^harbor-/.test(a.id) && isTeam(a.operator)) ?? raising.find((a) => isTeam(a.operator)) ?? raising[0];
  const go = document.querySelector("[data-live-pick-go]");
  if (!pick) {
    set("pick-state", "Nobody raising");
    set("pick-lead", "No business is raising a loan this minute. The market shows every loan, and new ones open often.");
    if (go) { go.textContent = "See the market"; go.href = "/market"; }
    return pick;
  }
  const loan = pick.current_loan;
  set("pick-name", pick.name);
  set("pick-state", LABEL.funding);
  set("pick-lead", "Raising a loan. Lenders’ money only moves once the loan is full; until then, any lender can take theirs back.");
  set("pick-funded", tusd(loan.funded));
  set("pick-principal", tusd(loan.terms.principal));
  set("pick-holders", String(loan.holders));
  set("pick-share", `${Number(loan.terms.lender_bps) / 100}% of every sale`);
  set("pick-due", tusd(loan.terms.total_due));
  bar("pick", Number(loan.funded) / Number(loan.terms.principal));
  if (go) { go.textContent = `Lend to ${pick.name}`; go.href = `/b/${pick.id}`; }
  return pick;
}

function showCounts(businesses, sales, newest) {
  set("count", String(businesses));
  set("jobs", String(sales));
  // The counts are shown only once read, never a stale number baked into the HTML.
  const counts = document.querySelector("[data-live-counts]");
  const fallback = document.querySelector("[data-live-fallback]");
  if (counts) counts.hidden = false;
  if (fallback) fallback.hidden = true;
  if (newest) {
    set("last-sale", ago(newest));
    const holder = document.querySelector("[data-live-last]");
    if (holder) holder.hidden = false;
  }
}

/**
 * The figures come from /api/market: the same cached snapshot of the contracts' views that the
 * app's market and business pages show, rounded by the same rule (web/src/lib/format.ts), so the
 * landing and the app agree to the cent. Only if it cannot be reached does the page ask NEAR RPC
 * nodes itself. Until either answers, the page shows placeholders, never a figure baked into the HTML.
 */
async function live() {
  try {
    const res = await fetch("/api/market", { cache: "no-store", signal: AbortSignal.timeout(12000) });
    const market = await res.json();
    if (!res.ok || !Array.isArray(market.businesses)) throw new Error("no snapshot");
    const byId = (id) => market.businesses.find((b) => b.id === id);
    showSamples(byId);
    const pick = showPick(market.businesses);
    renderMarket(market.businesses.map((b) => b.id), market.businesses.map((value) => ({ status: "fulfilled", value })), pick?.id);
    const newest = Math.max(0, ...market.activity.filter((a) => a.key.includes(":job:")).map((a) => a.at));
    showCounts(market.stats.businesses, market.stats.checksSold, newest);
    return;
  } catch { /* fall back to the chain directly */ }
  try {
    const ids = (await view(REGISTRY, "get_agents", { limit: 100 })).filter((id) => !isTest(id));
    const all = await Promise.allSettled(ids.map((id) => view(id, "get_agent")));
    const byId = (id) => { const r = all[ids.indexOf(id)]; return r?.status === "fulfilled" ? r.value : null; };
    showSamples(byId);
    const read = all.flatMap((r, i) => (r.status === "fulfilled" ? [{ ...r.value, id: ids[i] }] : []));
    const pick = showPick(read);
    renderMarket(ids, all, pick?.id);
    const jobs = all.reduce((n, r) => n + (r.status === "fulfilled" ? Number(r.value.stats.jobs_done) : 0), 0);
    const latest = await Promise.all(ids.map((id) => view(id, "get_jobs", { limit: 1 }).then((j) => Number(j[0]?.created_at ?? 0), () => 0)));
    showCounts(ids.length, jobs, Math.max(0, ...latest));
  } catch { /* the placeholders stand */ }
}

// The team's accounts (web/src/lib/demo.ts isTeamAccount): role accounts, agents and their sub-accounts.
const isTeam = (account) => !/\.guests\.[a-z\d-]+\.testnet$/.test(account) && (/(^|\.)lien-(f\d+|lender|borrower|vault|tap)-\d+\.testnet$/.test(account) || account === "lien-13569.testnet" || account.endsWith(".lien-13569.testnet"));
// Test businesses the team runs (web/src/lib/demo.ts looksLikeProbe): never featured.
const PROBE = /\b(probe|audit|critic|test|lumen|injection)\b/i;
// The app's own words for each state (web/src/lib/status.ts STANDING_LABEL), so a badge reads the same on both.
const LABEL = { "no-loan": "No loan", funding: "Raising", current: "Paying on time", behind: "Behind on payments", foreclosable: "Can be taken over", foreclosed: "Taken over, for sale", auction: "For sale, bids in", "sale-ended": "Auction ended" };
// A payment due every few minutes marks a staged demo loan (web/src/lib/demo.ts isStagedLoan).
const staged = (loan) => loan && Number(loan.terms.window_secs) < 3600;
const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ESC[c]);

/** web/src/lib/status.ts standing(), in the same order. */
function standing(a) {
  const loan = a.current_loan;
  if (!loan) return "no-loan";
  if (loan.status === "Funding") return "funding";
  if (loan.status === "Foreclosed") {
    if (loan.auction.ends_at !== null && a.now >= loan.auction.ends_at) return "sale-ended";
    return loan.auction.high_bidder ? "auction" : "foreclosed";
  }
  if (loan.foreclosable_at !== null && a.now >= loan.foreclosable_at) return "foreclosable";
  return loan.is_behind ? "behind" : "current";
}

/** The market window shows the live businesses the team runs, each a link to its page. */
function renderMarket(ids, all, picked) {
  const list = document.querySelector("[data-live-market]");
  if (!list) return;
  const rows = [];
  ids.forEach((id, i) => {
    const r = all[i];
    if (r.status !== "fulfilled" || !isTeam(r.value.operator) || PROBE.test(r.value.name)) return;
    const a = r.value;
    const loan = a.current_loan;
    const s = standing(a);
    const demo = staged(loan) ? "Staged demo: " : "";
    let sub = "Sells safety checks", rank = 5;
    if (s === "funding") { sub = `$${tusd(loan.funded)} of $${tusd(loan.terms.principal)} raised`; rank = 1; }
    else if (s === "foreclosable") { sub = `${demo}missed payments, $${owedUsd(loan.terms.total_due, loan.repaid)} owed`; rank = 0; }
    else if (s === "current" || s === "behind") { sub = `$${repaidUsd(loan.terms.total_due, loan.repaid)} of $${tusd(loan.terms.total_due)} paid back`; rank = 3; }
    else if (s !== "no-loan") { sub = `${demo}lowest bid $${fromCents(centsUp(loan.min_next_bid || "0"))}`; rank = 2; }
    const warn = !["no-loan", "funding", "current"].includes(s);
    const sel = id === picked ? ' class="is-sel"' : "";
    rows.push({ rank: id === picked ? -1 : rank, name: a.name, html: `<li${sel}><a href="/b/${esc(id)}"><span class="mk__who"><b>${esc(a.name)}</b><span>${esc(sub.charAt(0).toUpperCase() + sub.slice(1))}</span></span><span class="ui-chip${warn ? " is-warn" : ""}">${esc(LABEL[s])}</span></a></li>` });
  });
  // One row per name: two samples both called "Lookout" show once, the one most worth acting on.
  const seen = new Set();
  const unique = rows.sort((x, y) => x.rank - y.rank).filter((r) => (seen.has(r.name) ? false : (seen.add(r.name), true)));
  if (unique.length) list.innerHTML = unique.slice(0, 6).map((r) => r.html).join("");
}

/**
 * The Product menu by keyboard, on desktop: it opens when its word is focused (CSS :focus-within)
 * and on Enter, Space or the down arrow, which also move into it; Escape closes it and puts focus
 * back on the word, without leaving the page header.
 */
function menuKeys() {
  for (const item of document.querySelectorAll(".nav__item")) {
    const menu = item.querySelector(".nav__menu");
    const trigger = item.querySelector(".nav__link");
    if (!menu || !trigger) continue;
    const desktop = () => window.matchMedia("(min-width: 1024px)").matches;
    if (!menu.id) menu.id = `menu-${Math.random().toString(36).slice(2, 8)}`;
    trigger.setAttribute("aria-haspopup", "true");
    trigger.setAttribute("aria-controls", menu.id);
    const expanded = (open) => trigger.setAttribute("aria-expanded", String(open));
    expanded(false);
    const open = () => { item.classList.remove("is-menu-closed"); item.classList.add("is-menu-open"); expanded(true); };
    const close = () => { item.classList.remove("is-menu-open"); item.classList.add("is-menu-closed"); expanded(false); };
    trigger.addEventListener("focus", () => { if (desktop()) open(); });
    item.addEventListener("mouseenter", () => { item.classList.remove("is-menu-closed"); expanded(true); });
    item.addEventListener("mouseleave", () => { if (!item.contains(document.activeElement)) { item.classList.remove("is-menu-open", "is-menu-closed"); expanded(false); } });
    item.addEventListener("focusout", (e) => { if (!item.contains(e.relatedTarget)) { item.classList.remove("is-menu-open", "is-menu-closed"); expanded(false); } });
    trigger.addEventListener("keydown", (e) => {
      if (!desktop() || !["Enter", " ", "ArrowDown"].includes(e.key)) return;
      e.preventDefault();
      open();
      menu.querySelector("a")?.focus();
    });
    item.addEventListener("keydown", (e) => {
      if (e.key !== "Escape" || !desktop() || !item.classList.contains("is-menu-open")) return;
      e.stopPropagation(); // the page's own Escape handler would drop focus altogether
      close();
      trigger.focus();
      close();
    });
  }
}

simulator();
menuKeys();
live();
