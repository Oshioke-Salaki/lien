import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { counterMemo, type CounterMemo } from "../../lender/src/counter";
import { evaluate, units, type BusinessView, type Policy as LenderPolicy } from "../../lender/src/policy";
import { answerCounter, dueByWindowEnd, toContractTerms, type BorrowerPolicy } from "./terms";

const policy = JSON.parse(readFileSync(new URL("../policy.json", import.meta.url), "utf8")) as BorrowerPolicy;
const lenderPolicy = JSON.parse(readFileSync(new URL("../../lender/policy.json", import.meta.url), "utf8")) as LenderPolicy;
const BIZ = `courier-1.${policy.registry}`;
const opening = toContractTerms(policy.opening_terms);
const ok = { vetting: { verdict: "ALLOW", job_id: 7, tx: "T" }, lenderHolds: units("50") };
const counter = (over: Partial<CounterMemo> = {}): CounterMemo => ({
  ...counterMemo(BIZ, 0, { principal: units("10"), lender_bps: 2000, total_due: units("10.5"), will_fund: units("5"), reasons: ["x"] }, "abc"),
  ...over,
});

test("the opening offer falls short of the lender's policy, and the lender counters", () => {
  const view: BusinessView = {
    id: BIZ,
    name: "Courier",
    sells: policy.business.description,
    operator: "borrower.testnet",
    loan: { id: 0, state: "Funding" },
    terms: { principal: opening.principal, total_due: opening.total_due, lender_bps: opening.lender_bps, funded: "0", funding_deadline: null },
    repayment_record: { loans: 1, repaid: 0, foreclosed: 0, behind_now: false },
    trust: {
      business: { score: 25, level: "medium", flags: ["contract_is_locked_no_one_can_change_it", "almost_no_balance", "very_small_contract"], keys: [0, 0], verdict: "WARN" },
      operator: { score: 15, level: "low", flags: ["almost_no_balance"], keys: [1, 0], verdict: "ALLOW" },
    },
  };
  const d = evaluate(view, lenderPolicy, { exposure: 0n, alreadyLent: false });
  assert.equal(d.decision, "decline");
  assert.ok(d.decision === "decline" && d.counter, "a price-only shortfall gets a counter");
  // The borrower accepts that counter under its own policy, and the re-offer passes the lender.
  const c = d.decision === "decline" && d.counter ? counterMemo(BIZ, 0, d.counter, "p") : counter();
  const a = answerCounter(opening, c, policy, ok);
  assert.equal(a.decision, "accept");
  const re = a.decision === "accept" ? a.terms : opening;
  const again = evaluate({ ...view, loan: { id: 1, state: "Funding" }, terms: { ...view.terms!, lender_bps: re.lender_bps, total_due: re.total_due } }, lenderPolicy, { exposure: 0n, alreadyLent: false });
  assert.equal(again.decision, "lend");
});

test("accepts a counter inside its limits and changes only the price", () => {
  const a = answerCounter(opening, counter(), policy, ok);
  assert.equal(a.decision, "accept");
  if (a.decision !== "accept") return;
  assert.equal(a.terms.lender_bps, 2000);
  assert.equal(a.terms.total_due, units("10.5").toString());
  assert.equal(a.terms.principal, opening.principal);
  assert.equal(a.terms.window_secs, opening.window_secs);
});

test("walks away from a counter outside its limits, with every reason", () => {
  const a = answerCounter(opening, counter({ lender_bps: 4000, total_due: units("12").toString() }), policy, ok);
  assert.equal(a.decision, "walk_away");
  assert.equal(a.reasons.length, 2);
  assert.match(a.reasons.join(" "), /40% of sales/);
  assert.match(a.reasons.join(" "), /20% over principal/);
});

test("walks away when the lender cannot back its counter or fails the check", () => {
  assert.match(answerCounter(opening, counter(), policy, { ...ok, lenderHolds: units("1") }).reasons.join(" "), /less than the 5/);
  assert.match(answerCounter(opening, counter(), policy, { ...ok, vetting: { verdict: "BLOCK" } }).reasons.join(" "), /BLOCK/);
  assert.match(answerCounter(opening, counter(), policy, { ...ok, vetting: { verdict: null } }).reasons.join(" "), /missing/);
  assert.match(answerCounter(opening, counter({ principal: units("50").toString() }), policy, ok).reasons.join(" "), /counter is for 50/);
  assert.match(answerCounter(opening, counter({ will_fund: "0" }), policy, ok).reasons.join(" "), /commits nothing/);
});

test("repays what the schedule needs by the end of each window, never more than the debt", () => {
  const w = 1000;
  assert.equal(dueByWindowEnd(100, 0, w, 2n, 10n), 2n);
  assert.equal(dueByWindowEnd(1500, 0, w, 2n, 10n), 4n);
  assert.equal(dueByWindowEnd(99_000, 0, w, 2n, 10n), 10n);
});
