import assert from "node:assert/strict";
import { test } from "node:test";
import { checkInput, checkRefusal, refusalMessage, reusableCheck, type SentinelJob, type Vault2Policy } from "./verdict";

const VAULT = "lendvault2.lien-vault-48296.testnet";
const OPERATOR = "lien-f4-3863.testnet";
const PINNED = "b440dfe287452a6edcdc430f3375b664092aeb18eae584925b3c2ef3f842acd5";
const NOW = 1_794_654_000;
const policy: Vault2Policy = { sentinel: "sentinel.v1.lien-13569.testnet", max_check_age_secs: 86_400, allow_warn: false, max_check_price: "500000", max_check_spend: "5000000" };
const facts = { vault: VAULT, operator: OPERATOR, pinnedHash: PINNED, now: NOW };

const job = (over: Partial<SentinelJob> = {}, report: Record<string, unknown> = {}): SentinelJob => ({
  id: 41,
  payer: VAULT,
  input: checkInput(OPERATOR),
  status: "Done",
  report: JSON.stringify({ target: OPERATOR, level: "low", score: 0, flags: [], keys: [1, 0], ...report }),
  created_at: NOW - 60,
  wasm_hash: PINNED,
  ...over,
});

test("a recent low check this vault bought on the operator passes", () => {
  assert.equal(checkRefusal(job(), policy, facts), null);
});

test("each rule the vault enforces is mirrored, in the vault's order", () => {
  assert.match(checkRefusal(null, policy, facts)!, /no such job/);
  assert.match(checkRefusal(job({ status: "Pending", report: null }), policy, facts)!, /not Done \(status Pending\)/);
  assert.match(checkRefusal(job({ status: "Refunded" }), policy, facts)!, /not Done/);
  assert.match(checkRefusal(job({ payer: "lien-borrower-648257.testnet" }), policy, facts)!, /paid by lien-borrower-648257.testnet, not by this vault/);
  assert.match(checkRefusal(job({ wasm_hash: "9fd9a77a" }), policy, facts)!, /not Sentinel's pinned build/);
  assert.match(checkRefusal(job({ created_at: NOW - 86_401 }), policy, facts)!, /86401 seconds old/);
  assert.equal(checkRefusal(job({ created_at: NOW - 86_400 }), policy, facts), null);
  assert.match(checkRefusal(job({}, { level: "high" }), policy, facts)!, /high risk \(BLOCK\)/);
  assert.match(checkRefusal(job({}, { level: "medium" }), policy, facts)!, /medium risk \(WARN\)/);
  assert.equal(checkRefusal(job({}, { level: "medium" }), { ...policy, allow_warn: true }, facts), null);
  assert.match(checkRefusal(job({ report: null }), policy, facts)!, /no readable report/);
  assert.match(checkRefusal(job({ report: "not json" }), policy, facts)!, /no readable report/);
  assert.match(
    checkRefusal(job({ input: checkInput("lien-f6-3876.testnet") }, { target: "lien-f6-3876.testnet" }), policy, facts)!,
    /on lien-f6-3876.testnet, not on the business's operator lien-f4-3863.testnet/,
  );
  assert.match(checkRefusal(job({}, { target: "someone-else.testnet" }), policy, facts)!, /not on the business's operator/);
});

test("a high verdict is refused before the target is compared, as on chain", () => {
  const other = job({ input: checkInput("nobody.testnet") }, { target: "nobody.testnet", level: "high" });
  assert.match(checkRefusal(other, policy, facts)!, /high risk/);
});

test("the newest passing check is reused; failing ones are skipped", () => {
  const jobs = [job({ id: 50 }, { level: "high" }), job({ id: 44 }), job({ id: 47 }), job({ id: 49, payer: "x.testnet" })];
  assert.equal(reusableCheck(jobs, policy, facts)?.id, 47);
  assert.equal(reusableCheck([job({ id: 50 }, { level: "high" })], policy, facts), null);
  assert.equal(reusableCheck([], policy, facts), null);
});

test("the refusal message is pulled out of NEAR's failure object", () => {
  const failure = { ActionError: { index: 0, kind: { FunctionCallError: { ExecutionError: "Smart contract panicked: refused: check 40 was paid by lien-borrower-648257.testnet, not by this vault" } } } };
  assert.equal(refusalMessage(failure), "refused: check 40 was paid by lien-borrower-648257.testnet, not by this vault");
  assert.equal(refusalMessage({ other: 1 }), '{"other":1}');
});
