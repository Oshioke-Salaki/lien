// The landing page's two live parts, with no framework:
// 1. the simulator, which runs the contract's own waterfall rule (web/src/lib/math.ts splitInflow);
// 2. the figures read from NEAR testnet. Every figure has a real fallback in the HTML, so a slow
//    or failed RPC leaves the page correct, only a little older.

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
    set('[data-testid="monthly-lender"]', dollars(split.lender));
    set('[data-sim="operator"]', dollars(split.operator));
    set('[data-sim="opex"]', dollars(split.opex));
    set('[data-testid="payoff"]', months === null ? "never" : `${months} ${months === 1n ? "month" : "months"}`);
    set('[data-sim="repaid"]', dollars(repaid));
    set('[data-testid="still-owed"]', dollars(outstanding));
    set('[data-sim="price"]', dollars(price));
    set('[data-testid="recovered"]', dollars(repaid + toLenders));
    set('[data-sim="surplus"]', dollars(price - toLenders));

    notice.dataset.state = noticed ? "foreclosed" : "active";
    set('[data-sim="title"]', noticed ? "Notice of foreclosure" : cleared ? "Lien released" : "Record of lien");
    set('[data-sim="note"]', noticed
      ? "The address and the service stay exactly as they were. Only the owner changes."
      : cleared ? "The debt cleared before payments stopped, so the operator keeps everything."
      : "Current. Nobody holds a key to this business.");
    $('[data-sim="stamp"]', root).hidden = !noticed;
    $('[data-sim="running"]', root).hidden = stopped;
    $('[data-sim="stopped"]', root).hidden = !stopped;
    stop.setAttribute("aria-pressed", String(stopped));
    stop.textContent = stopped ? "Start paying again" : "Stop the payments after 3 months";
  };

  for (const input of [revenue, share]) input.addEventListener("input", render);
  bid.addEventListener("input", () => { stopped = true; render(); });
  stop.addEventListener("click", () => { stopped = !stopped; render(); });
  render();
}

// ---- live figures ----
const REGISTRY = "v1.lien-13569.testnet";
const RPCS = ["https://rpc.testnet.fastnear.com", "https://test.rpc.fastnear.com", "https://rpc.testnet.near.org"];

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

const tusd = (v) => (Number(BigInt(v)) / 1e6).toFixed(2);
const isTest = (id) => id.startsWith("e2e-") || id.startsWith("ui-");

async function live() {
  const set = (key, text) => { for (const el of document.querySelectorAll(`[data-live="${key}"]`)) el.textContent = text; };
  try {
    const ids = (await view(REGISTRY, "get_agents", { limit: 100 })).filter((id) => !isTest(id));
    set("count", String(ids.length));
    const all = await Promise.allSettled(ids.map((id) => view(id, "get_agent")));
    const jobs = all.reduce((n, r) => n + (r.status === "fulfilled" ? Number(r.value.stats.jobs_done) : 0), 0);
    set("jobs", String(jobs));
    const sentinel = all[ids.indexOf(`sentinel.${REGISTRY}`)];
    const loan = sentinel?.status === "fulfilled" ? sentinel.value.current_loan : null;
    if (loan) {
      set("sentinel-owed", tusd(loan.outstanding));
      set("sentinel-repaid", tusd(loan.repaid));
      set("sentinel-holders", String(loan.holders));
      set("sentinel-state", loan.is_behind ? "Behind" : loan.status === "Active" ? "Paying on time" : loan.status);
      const bar = document.querySelector('[data-live-bar="sentinel"]');
      if (bar) bar.style.setProperty("--k", String(Number(loan.repaid) / Number(loan.terms.total_due)));
    }
  } catch { /* the HTML figures stand */ }
}

simulator();
live();
