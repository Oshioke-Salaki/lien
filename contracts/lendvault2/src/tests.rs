//! Promise results are mocked with `testing_env!`: each callback is run with
//! the views or token results it would receive on chain.

use super::*;
use near_sdk::mock::MockAction;
use near_sdk::test_utils::{get_created_receipts, get_logs, VMContextBuilder};
use near_sdk::{testing_env, PromiseResult};

const USD: u128 = 1_000_000;
const VAULT: &str = "lendvault2.lien-vault-48296.testnet";
const AGENT: &str = "agent.lien-vault-48296.testnet";
const BENEFICIARY: &str = "lien-vault-48296.testnet";
const REGISTRY: &str = "v1.lien-13569.testnet";
const TOKEN: &str = "usd.lien-13569.testnet";
const SENTINEL: &str = "sentinel.v1.lien-13569.testnet";
const BUSINESS: &str = "harbor-48831.v1.lien-13569.testnet";
const OPERATOR: &str = "lien-f4-3863.testnet";
const PINNED: &str = "b440dfe287452a6edcdc430f3375b664092aeb18eae584925b3c2ef3f842acd5";
/// Block time in the mocked context, in seconds.
const NOW: u64 = 1_794_654_000;
const DAY: u64 = 86_400;
const JOB: u64 = 41;

fn acc(s: &str) -> AccountId {
    s.parse().unwrap()
}

fn ctx(predecessor: &str, deposit: u128) -> VMContextBuilder {
    let mut c = VMContextBuilder::new();
    c.current_account_id(acc(VAULT))
        .predecessor_account_id(acc(predecessor))
        .attached_deposit(NearToken::from_yoctonear(deposit))
        .block_timestamp(NOW * 1_000_000_000)
        .prepaid_gas(Gas::from_tgas(300));
    c
}

fn as_caller(predecessor: &str) {
    testing_env!(ctx(predecessor, 0).build());
}

/// The vault calling itself back, with the given promise results.
fn callback(results: Vec<PromiseResult>) {
    testing_env!(
        ctx(VAULT, 0).build(),
        near_sdk::test_vm_config(),
        near_sdk::RuntimeFeesConfig::test(),
        Default::default(),
        results
    );
}

fn policy(allow_warn: bool) -> Policy {
    Policy {
        token: acc(TOKEN),
        registry: acc(REGISTRY),
        sentinel: acc(SENTINEL),
        beneficiary: acc(BENEFICIARY),
        agent: acc(AGENT),
        max_per_loan: U128(10 * USD),
        max_share_bps: 5000,
        total_budget: U128(30 * USD),
        max_check_price: U128(USD / 2),
        max_check_spend: U128(USD),
        max_check_age_secs: DAY,
        allow_warn,
    }
}

fn vault_with(allow_warn: bool) -> LendVault {
    as_caller(BENEFICIARY);
    LendVault::new(policy(allow_warn))
}

fn vault() -> LendVault {
    vault_with(false)
}

fn ok<T: near_sdk::serde::Serialize>(value: &T) -> PromiseResult {
    PromiseResult::Successful(serde_json::to_vec(value).unwrap())
}

fn parse<T: near_sdk::serde::de::DeserializeOwned>(value: serde_json::Value) -> T {
    serde_json::from_value(value).unwrap()
}

/// A `get_agent` answer with the fields a business really returns, plus some the vault ignores.
fn agent_json(status: &str, principal: u128, funded: u128) -> serde_json::Value {
    json!({
        "name": "Harbor",
        "registry": REGISTRY,
        "token": TOKEN,
        "operator": OPERATOR,
        "ledger": { "opex": "0" },
        "current_loan": {
            "id": 0,
            "terms": { "principal": principal.to_string(), "total_due": (principal * 105 / 100).to_string(), "lender_bps": 500 },
            "status": status,
            "created_at": 1_000,
            "funding_deadline": 2_000_000_000u64,
            "funded": funded.to_string(),
            "repaid": "0",
            "holders": 0
        },
        "now": NOW
    })
}

fn agent_lite(status: &str, principal: u128, funded: u128) -> AgentLite {
    parse(agent_json(status, principal, funded))
}

/// A `get_job` answer as Sentinel writes it, for a passing check this vault bought.
fn job_json(level: &str) -> serde_json::Value {
    let report = json!({ "flags": [], "keys": [1, 0], "level": level, "network": "testnet", "score": 0, "target": OPERATOR });
    json!({
        "id": JOB,
        "payer": VAULT,
        "paid": "250000",
        "input": format!("check {OPERATOR}"),
        "status": "Done",
        "report": report.to_string(),
        "created_at": NOW - 120,
        "wasm_hash": PINNED,
    })
}

fn job(level: &str) -> JobLite {
    parse(job_json(level))
}

/// The part of Sentinel's `get_agent` the vault reads, with a few fields it ignores.
fn sentinel() -> SentinelLite {
    parse(json!({ "name": "Sentinel", "operator": "lien-f1-3833.testnet", "service": { "price": "250000", "wasm": { "url": "https://x", "hash": PINNED, "build_target": "wasm32-wasip2" } }, "next_job_id": 42, "now": NOW }))
}

/// The function calls the contract created, as (receiver, method, args, deposit).
fn calls() -> Vec<(String, String, serde_json::Value, u128)> {
    get_created_receipts()
        .into_iter()
        .flat_map(|r| {
            let receiver = r.receiver_id.to_string();
            r.actions.into_iter().filter_map(move |a| match a {
                MockAction::FunctionCallWeight { method_name, args, attached_deposit, .. } => Some((
                    receiver.clone(),
                    String::from_utf8(method_name).unwrap(),
                    serde_json::from_slice(&args).unwrap_or(serde_json::Value::Null),
                    attached_deposit.as_yoctonear(),
                )),
                _ => None,
            })
        })
        .collect()
}

/// Runs `on_checked` as the vault, with the four views it would receive.
fn checked(v: &mut LendVault, amount: u128, agent: AgentLite, job: Option<JobLite>, s: SentinelLite) {
    callback(vec![]);
    let _ = v.on_checked(acc(BUSINESS), U128(amount), JOB, Ok(vec![acc(BUSINESS)]), Ok(agent), Ok(job), Ok(s));
}

/// The verdict checks alone, on a loan that is otherwise fine.
fn with_job(v: &mut LendVault, job: Option<JobLite>) {
    checked(v, USD, agent_lite("Funding", 6 * USD, USD), job, sentinel());
}

/// Runs a whole lend: the agent's call, then the checked callback with mocked views.
fn lend_through(v: &mut LendVault, amount: u128, principal: u128, funded: u128) {
    as_caller(AGENT);
    let _ = v.lend(acc(BUSINESS), U128(amount), JOB, None);
    checked(v, amount, agent_lite("Funding", principal, funded), Some(job("low")), sentinel());
}

fn settle(v: &mut LendVault, amount: u128, used: u128) {
    callback(vec![ok(&U128(used))]);
    v.on_lent(acc(BUSINESS), 0, U128(amount), Ok(U128(used)));
}

// ---------- hire_check ----------

#[test]
fn hire_check_pays_sentinel_from_the_vault_with_the_exact_message() {
    let mut v = vault();
    as_caller(AGENT);
    let _ = v.hire_check(acc(OPERATOR));
    let sent: Vec<_> = calls().into_iter().filter(|c| c.1 == "ft_transfer_call").collect();
    assert_eq!(sent.len(), 1);
    let (receiver, _, args, deposit) = &sent[0];
    assert_eq!(receiver, TOKEN);
    assert_eq!(*deposit, 1, "the vault attaches the 1 yoctoNEAR itself");
    assert_eq!(args["receiver_id"], SENTINEL);
    assert_eq!(args["amount"], (USD / 2).to_string());
    let msg: serde_json::Value = serde_json::from_str(args["msg"].as_str().unwrap()).unwrap();
    assert_eq!(msg, json!({ "action": "job", "input": format!("check {OPERATOR}") }));
    assert_eq!(v.get_totals().check_in_flight.0, USD / 2);
    assert!(calls().iter().any(|c| c.0 == VAULT && c.1 == "on_check_paid"));
}

#[test]
fn a_paid_check_is_settled_found_and_recorded() {
    let mut v = vault();
    as_caller(AGENT);
    let _ = v.hire_check(acc(OPERATOR));

    // Sentinel kept its price of 0.25; the token sent the other 0.25 back.
    callback(vec![ok(&U128(250_000))]);
    let _ = v.on_check_paid(acc(OPERATOR), U128(USD / 2), Ok(U128(250_000)));
    let t = v.get_totals();
    assert_eq!((t.check_spent.0, t.check_in_flight.0, t.check_budget_left.0), (250_000, 0, 750_000));
    assert!(calls().iter().any(|c| c.0 == SENTINEL && c.1 == "get_jobs"));

    // Sentinel's newest jobs: someone else's, then ours (still pending).
    let mut theirs = job_json("low");
    theirs["id"] = json!(JOB + 1);
    theirs["payer"] = json!("someone.testnet");
    let mut ours = job_json("low");
    ours["status"] = json!("Pending");
    ours["report"] = serde_json::Value::Null;
    let jobs: Vec<JobLite> = vec![parse(theirs), parse(ours)];
    callback(vec![]);
    assert_eq!(v.on_check_found(acc(OPERATOR), U128(250_000), Ok(jobs)), Some(JOB));
    let c = v.get_check(JOB).unwrap();
    assert_eq!((c.target.as_str(), c.paid.0), (OPERATOR, 250_000));
    assert_eq!(v.get_totals().checks, 1);
    assert!(get_logs().iter().any(|l| l.contains("check_hired")));
}

#[test]
fn a_bounced_check_payment_spends_nothing() {
    let mut v = vault();
    as_caller(AGENT);
    let _ = v.hire_check(acc(OPERATOR));
    callback(vec![ok(&U128(0))]);
    let _ = v.on_check_paid(acc(OPERATOR), U128(USD / 2), Ok(U128(0)));
    let t = v.get_totals();
    assert_eq!((t.check_spent.0, t.check_in_flight.0, t.check_budget_left.0), (0, 0, USD));
    callback(vec![PromiseResult::Failed]);
    let _ = v.on_check_paid(acc(OPERATOR), U128(USD / 2), Err(PromiseError::Failed));
    assert_eq!(v.get_totals().check_spent.0, 0);
}

#[test]
#[should_panic(expected = "refused: a check of up to 500000 is above what is left of max_check_spend (0)")]
fn check_spending_is_capped() {
    let mut v = vault();
    for _ in 0..2 {
        as_caller(AGENT);
        let _ = v.hire_check(acc(OPERATOR));
    }
    as_caller(AGENT);
    // Two checks in flight use the whole 1 tUSD; the third is refused.
    let _ = v.hire_check(acc(OPERATOR));
}

#[test]
#[should_panic(expected = "refused: only the agent agent.lien-vault-48296.testnet can do this")]
fn only_the_agent_can_hire_a_check() {
    let mut v = vault();
    as_caller(BENEFICIARY);
    let _ = v.hire_check(acc(OPERATOR));
}

#[test]
#[should_panic(expected = "refused: hire_check takes no deposit")]
fn hire_check_takes_no_deposit() {
    let mut v = vault();
    testing_env!(ctx(AGENT, 1).build());
    let _ = v.hire_check(acc(OPERATOR));
}

// ---------- lend: happy path ----------

#[test]
fn lend_reads_the_registry_the_business_and_sentinel_before_anything_moves() {
    let mut v = vault();
    as_caller(AGENT);
    let _ = v.lend(acc(BUSINESS), U128(USD), JOB, None);
    let calls = calls();
    let methods: Vec<_> = calls.iter().map(|c| (c.0.as_str(), c.1.as_str())).collect();
    assert!(methods.contains(&(REGISTRY, "get_agents")));
    assert!(methods.contains(&(BUSINESS, "get_agent")));
    assert!(methods.contains(&(SENTINEL, "get_job")));
    assert!(methods.contains(&(SENTINEL, "get_agent")));
    assert!(methods.contains(&(VAULT, "on_checked")));
    assert!(calls.iter().any(|c| c.1 == "get_job" && c.2["job_id"] == JOB));
    assert!(!methods.iter().any(|(_, m)| *m == "ft_transfer_call"), "no money moves before the checks");
    assert_eq!(v.get_totals().in_flight.0, 0);
}

#[test]
fn a_recent_low_check_on_the_operator_lets_the_loan_through() {
    let mut v = vault();
    lend_through(&mut v, USD, 6 * USD, USD);
    let sent: Vec<_> = calls().into_iter().filter(|c| c.1 == "ft_transfer_call").collect();
    assert_eq!(sent.len(), 1);
    let (receiver, _, args, deposit) = &sent[0];
    assert_eq!((receiver.as_str(), *deposit), (TOKEN, 1));
    assert_eq!(args["receiver_id"], BUSINESS);
    assert_eq!(args["amount"], USD.to_string());
    let msg: serde_json::Value = serde_json::from_str(args["msg"].as_str().unwrap()).unwrap();
    assert_eq!(msg, json!({ "action": "fund", "loan_id": 0 }));
    assert!(get_logs().iter().any(|l| l.contains("lend_sent") && l.contains("\"check_job_id\":41")));
    settle(&mut v, USD, USD);
    let t = v.get_totals();
    assert_eq!((t.lent.0, t.in_flight.0, t.lends), (USD, 0, 1));
}

#[test]
fn a_medium_check_passes_when_the_vault_allows_warn() {
    let mut v = vault_with(true);
    with_job(&mut v, Some(job("medium")));
    assert_eq!(v.get_totals().in_flight.0, USD);
}

#[test]
fn a_check_just_inside_the_age_limit_passes() {
    let mut v = vault();
    let mut j = job("low");
    j.created_at = NOW - DAY;
    with_job(&mut v, Some(j));
    assert_eq!(v.get_totals().in_flight.0, USD);
}

// ---------- lend: refusals on the verdict ----------

#[test]
#[should_panic(expected = "refused: Sentinel has no job 41")]
fn a_missing_job_is_refused() {
    let mut v = vault();
    with_job(&mut v, None);
}

#[test]
#[should_panic(expected = "refused: Sentinel sentinel.v1.lien-13569.testnet did not answer get_job")]
fn no_answer_from_sentinel_is_a_refusal() {
    let mut v = vault();
    callback(vec![]);
    let _ = v.on_checked(acc(BUSINESS), U128(USD), JOB, Ok(vec![acc(BUSINESS)]), Ok(agent_lite("Funding", 6 * USD, 0)), Err(PromiseError::Failed), Ok(sentinel()));
}

#[test]
#[should_panic(expected = "refused: check 41 is not Done (status Pending)")]
fn a_pending_job_is_refused() {
    let mut v = vault();
    let mut j = job("low");
    j.status = "Pending".into();
    j.report = None;
    with_job(&mut v, Some(j));
}

#[test]
#[should_panic(expected = "refused: check 41 is not Done (status Refunded)")]
fn a_refunded_job_is_refused() {
    let mut v = vault();
    let mut j = job("low");
    j.status = "Refunded".into();
    with_job(&mut v, Some(j));
}

#[test]
#[should_panic(expected = "refused: check 41 was paid by lien-borrower-648257.testnet, not by this vault")]
fn a_job_paid_by_someone_else_is_refused() {
    let mut v = vault();
    let mut j = job("low");
    j.payer = acc("lien-borrower-648257.testnet");
    with_job(&mut v, Some(j));
}

#[test]
#[should_panic(expected = "refused: check 41 is on lien-f6-3876.testnet, not on the business's operator lien-f4-3863.testnet")]
fn a_check_on_another_account_is_refused() {
    let mut v = vault();
    let mut j = job("low");
    j.input = "check lien-f6-3876.testnet".into();
    j.report = Some(json!({ "level": "low", "target": "lien-f6-3876.testnet", "score": 15 }).to_string());
    with_job(&mut v, Some(j));
}

#[test]
#[should_panic(expected = "not on the business's operator lien-f4-3863.testnet")]
fn a_report_whose_target_differs_from_the_input_is_refused() {
    let mut v = vault();
    let mut j = job("low");
    j.report = Some(json!({ "level": "low", "target": "someone-else.testnet" }).to_string());
    with_job(&mut v, Some(j));
}

#[test]
#[should_panic(expected = "not on the business's operator")]
fn a_check_on_the_business_rather_than_its_operator_is_refused() {
    let mut v = vault();
    let mut j = job("low");
    j.input = format!("check {BUSINESS}");
    j.report = Some(json!({ "level": "low", "target": BUSINESS }).to_string());
    with_job(&mut v, Some(j));
}

#[test]
#[should_panic(expected = "refused: check 41 is 86401 seconds old, above max_check_age_secs 86400")]
fn a_stale_check_is_refused() {
    let mut v = vault();
    let mut j = job("low");
    j.created_at = NOW - DAY - 1;
    with_job(&mut v, Some(j));
}

#[test]
#[should_panic(expected = "refused: check 41 on lien-f4-3863.testnet is high risk (BLOCK)")]
fn a_high_risk_verdict_is_refused() {
    let mut v = vault();
    with_job(&mut v, Some(job("high")));
}

#[test]
#[should_panic(expected = "is high risk (BLOCK)")]
fn a_high_risk_verdict_is_refused_even_when_warn_is_allowed() {
    let mut v = vault_with(true);
    with_job(&mut v, Some(job("high")));
}

#[test]
#[should_panic(expected = "refused: check 41 on lien-f4-3863.testnet is medium risk (WARN), and this vault lends only on low")]
fn a_medium_verdict_is_refused_without_allow_warn() {
    let mut v = vault();
    with_job(&mut v, Some(job("medium")));
}

#[test]
#[should_panic(expected = "refused: check 41 has an unknown level")]
fn an_unknown_level_is_refused() {
    let mut v = vault_with(true);
    with_job(&mut v, Some(job("none")));
}

#[test]
#[should_panic(expected = "refused: check 41 has no readable report")]
fn a_done_job_without_a_report_is_refused() {
    let mut v = vault();
    let mut j = job("low");
    j.report = None;
    with_job(&mut v, Some(j));
}

#[test]
#[should_panic(expected = "refused: check 41 ran build 9fd9a77a, not Sentinel's pinned build b440dfe2")]
fn a_check_from_another_build_is_refused() {
    let mut v = vault();
    let mut j = job("low");
    j.wasm_hash = "9fd9a77a".into();
    let mut s = sentinel();
    s.service.wasm.hash = "b440dfe2".into();
    checked(&mut v, USD, agent_lite("Funding", 6 * USD, USD), Some(j), s);
}

#[test]
#[should_panic(expected = "refused: Sentinel sentinel.v1.lien-13569.testnet did not answer get_agent")]
fn no_pinned_build_from_sentinel_is_a_refusal() {
    let mut v = vault();
    callback(vec![]);
    let _ = v.on_checked(acc(BUSINESS), U128(USD), JOB, Ok(vec![acc(BUSINESS)]), Ok(agent_lite("Funding", 6 * USD, 0)), Ok(Some(job("low"))), Err(PromiseError::Failed));
}

#[test]
#[should_panic(expected = "refused: Sentinel answered with another job")]
fn an_answer_about_another_job_is_refused() {
    let mut v = vault();
    let mut j = job("low");
    j.id = JOB + 1;
    with_job(&mut v, Some(j));
}

#[test]
fn a_refusal_on_the_verdict_leaves_no_trace() {
    let mut v = vault();
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let mut v2 = vault();
        with_job(&mut v2, Some(job("high")));
    }));
    assert!(result.is_err());
    // A fresh vault is unaffected, and nothing was reserved on this one.
    with_job(&mut v, Some(job("low")));
    assert_eq!(v.get_totals().in_flight.0, USD);
}

// ---------- lend: v1 refusals still hold ----------

#[test]
#[should_panic(expected = "refused: attacker.testnet is not a Lien business (not an account created under the registry")]
fn lending_to_an_ordinary_account_is_refused() {
    let mut v = vault();
    as_caller(AGENT);
    let _ = v.lend(acc("attacker.testnet"), U128(USD), JOB, None);
}

#[test]
#[should_panic(expected = "refused: sentinel-x.v1.lien-13569.testnet is not a Lien business (the registry v1.lien-13569.testnet does not list it)")]
fn an_account_under_the_registry_that_it_does_not_list_is_refused() {
    let mut v = vault();
    callback(vec![]);
    let _ = v.on_checked(acc("sentinel-x.v1.lien-13569.testnet"), U128(USD), JOB, Ok(vec![acc(BUSINESS)]), Ok(agent_lite("Funding", 6 * USD, 0)), Ok(Some(job("low"))), Ok(sentinel()));
}

#[test]
#[should_panic(expected = "refused: the registry did not answer")]
fn no_answer_from_the_registry_is_a_refusal() {
    let mut v = vault();
    callback(vec![]);
    let _ = v.on_checked(acc(BUSINESS), U128(USD), JOB, Err(PromiseError::Failed), Ok(agent_lite("Funding", 6 * USD, 0)), Ok(Some(job("low"))), Ok(sentinel()));
}

#[test]
#[should_panic(expected = "refused: the business uses another token")]
fn a_business_on_another_token_is_refused() {
    let mut v = vault();
    let mut a = agent_lite("Funding", 6 * USD, 0);
    a.token = acc("fake-usd.testnet");
    checked(&mut v, USD, a, Some(job("low")), sentinel());
}

#[test]
#[should_panic(expected = "is not raising (status Active)")]
fn a_loan_that_is_not_raising_is_refused() {
    let mut v = vault();
    checked(&mut v, USD, agent_lite("Active", 6 * USD, 6 * USD), Some(job("low")), sentinel());
}

#[test]
#[should_panic(expected = "has no open loan")]
fn a_business_with_no_loan_is_refused() {
    let mut v = vault();
    let mut a = agent_lite("Funding", 6 * USD, 0);
    a.current_loan = None;
    checked(&mut v, USD, a, Some(job("low")), sentinel());
}

#[test]
#[should_panic(expected = "refused: 10000001 is above max_per_loan 10000000")]
fn above_max_per_loan_is_refused() {
    let mut v = vault();
    as_caller(AGENT);
    let _ = v.lend(acc(BUSINESS), U128(10 * USD + 1), JOB, None);
}

#[test]
#[should_panic(expected = "above max_share_bps 5000 of the principal 6000000 (3000000)")]
fn above_the_share_of_one_loan_is_refused() {
    let mut v = vault();
    checked(&mut v, 4 * USD, agent_lite("Funding", 6 * USD, 0), Some(job("low")), sentinel());
}

#[test]
#[should_panic(expected = "is more than the 2000000 the loan still needs")]
fn more_than_the_loan_needs_is_refused() {
    let mut v = vault();
    checked(&mut v, 3 * USD, agent_lite("Funding", 200 * USD, 198 * USD), Some(job("low")), sentinel());
}

#[test]
#[should_panic(expected = "is above what is left of total_budget")]
fn money_in_flight_counts_against_the_budget() {
    let mut v = vault();
    for i in 0..3 {
        lend_through(&mut v, 10 * USD, 200 * USD, i * 10 * USD);
    }
    as_caller(AGENT);
    let _ = v.lend(acc(BUSINESS), U128(1), JOB, None);
}

#[test]
#[should_panic(expected = "refused: only the agent agent.lien-vault-48296.testnet can do this")]
fn only_the_agent_can_lend() {
    let mut v = vault();
    as_caller(BENEFICIARY);
    let _ = v.lend(acc(BUSINESS), U128(USD), JOB, None);
}

#[test]
#[should_panic(expected = "refused: lend takes no deposit")]
fn lend_takes_no_deposit() {
    let mut v = vault();
    testing_env!(ctx(AGENT, 1).build());
    let _ = v.lend(acc(BUSINESS), U128(USD), JOB, None);
}

#[test]
#[should_panic(expected = "refused: callbacks can only be called by the vault itself")]
fn the_callback_that_sends_money_cannot_be_called_from_outside() {
    let mut v = vault();
    as_caller(AGENT);
    let _ = v.on_checked(acc(BUSINESS), U128(USD), JOB, Ok(vec![acc(BUSINESS)]), Ok(agent_lite("Funding", 6 * USD, 0)), Ok(Some(job("low"))), Ok(sentinel()));
}

#[test]
#[should_panic(expected = "refused: callbacks can only be called by the vault itself")]
fn the_check_record_cannot_be_written_from_outside() {
    let mut v = vault();
    as_caller(AGENT);
    let _ = v.on_check_found(acc(OPERATOR), U128(1), Ok(vec![job("low")]));
}

// ---------- claim, foreclose, withdraw: as in v1 ----------

#[test]
fn claim_calls_the_business_and_records_the_repayment() {
    let mut v = vault();
    lend_through(&mut v, USD, 6 * USD, 0);
    settle(&mut v, USD, USD);
    as_caller(AGENT);
    let _ = v.claim(acc(BUSINESS), 0);
    assert!(calls().iter().any(|(r, m, a, d)| r == BUSINESS && m == "claim" && a["loan_id"] == 0 && *d == 0));
    callback(vec![ok(&U128(USD / 4))]);
    assert_eq!(v.on_claimed(acc(BUSINESS), 0, Ok(U128(USD / 4))).0, USD / 4);
    assert_eq!(v.get_totals().claimed.0, USD / 4);
}

#[test]
fn foreclose_calls_the_business_with_no_deposit() {
    let mut v = vault();
    lend_through(&mut v, USD, 6 * USD, 0);
    settle(&mut v, USD, USD);
    as_caller(BENEFICIARY);
    let _ = v.foreclose(acc(BUSINESS), 0);
    assert!(calls().iter().any(|(r, m, _, d)| r == BUSINESS && m == "foreclose" && *d == 0));
}

#[test]
fn withdraw_pays_only_the_beneficiary_whoever_calls() {
    for caller in [AGENT, BENEFICIARY] {
        let mut v = vault();
        as_caller(caller);
        let _ = v.withdraw(U128(7 * USD));
        let sent: Vec<_> = calls().into_iter().filter(|c| c.1 == "ft_transfer").collect();
        assert_eq!(sent.len(), 1);
        assert_eq!((sent[0].0.as_str(), sent[0].3), (TOKEN, 1));
        assert_eq!(sent[0].2["receiver_id"], BENEFICIARY);
        callback(vec![PromiseResult::Successful(vec![])]);
        assert_eq!(v.on_withdrawn(U128(7 * USD)).0, 7 * USD);
    }
}

#[test]
#[should_panic(expected = "refused: only the agent or the beneficiary can do this")]
fn a_stranger_cannot_withdraw() {
    let mut v = vault();
    as_caller("attacker.testnet");
    let _ = v.withdraw(U128(USD));
}

#[test]
#[should_panic(expected = "refused: the vault holds no note on loan 0 of attacker.testnet")]
fn claim_only_reaches_businesses_the_vault_lent_to() {
    let mut v = vault();
    as_caller(AGENT);
    let _ = v.claim(acc("attacker.testnet"), 0);
}

// ---------- init ----------

#[test]
fn the_policy_is_what_init_set() {
    let p = vault().get_policy();
    assert_eq!(p, policy(false));
}

#[test]
#[should_panic(expected = "max_check_spend must be at least max_check_price")]
fn init_rejects_a_check_budget_below_one_check() {
    as_caller(BENEFICIARY);
    let mut p = policy(false);
    p.max_check_spend = U128(1);
    let _ = LendVault::new(p);
}

#[test]
#[should_panic(expected = "the agent, the beneficiary and Sentinel must be other accounts")]
fn init_rejects_the_vault_as_sentinel() {
    as_caller(BENEFICIARY);
    let mut p = policy(false);
    p.sentinel = acc(VAULT);
    let _ = LendVault::new(p);
}

#[test]
fn check_input_and_sub_account() {
    assert_eq!(check_input(&acc(OPERATOR)), "check lien-f4-3863.testnet");
    let r = acc(REGISTRY);
    assert!(is_direct_sub_account(&acc(BUSINESS), &r));
    assert!(!is_direct_sub_account(&acc("a.b.v1.lien-13569.testnet"), &r));
    assert!(!is_direct_sub_account(&acc("lien-f4-3863.testnet"), &r));
}
