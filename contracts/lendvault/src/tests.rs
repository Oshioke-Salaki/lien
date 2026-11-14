//! Promise results are mocked with `testing_env!`: each callback is run with
//! the views or token results it would receive on chain.

use super::*;
use near_sdk::mock::MockAction;
use near_sdk::test_utils::{get_created_receipts, get_logs, VMContextBuilder};
use near_sdk::{testing_env, PromiseResult};

const USD: u128 = 1_000_000;
const VAULT: &str = "lendvault.lien-f4-3863.testnet";
const AGENT: &str = "lien-lender-645368.testnet";
const BENEFICIARY: &str = "lien-f4-3863.testnet";
const REGISTRY: &str = "v1.lien-13569.testnet";
const TOKEN: &str = "usd.lien-13569.testnet";
const BUSINESS: &str = "inject-45089.v1.lien-13569.testnet";

fn acc(s: &str) -> AccountId {
    s.parse().unwrap()
}

fn ctx(predecessor: &str, deposit: u128) -> VMContextBuilder {
    let mut c = VMContextBuilder::new();
    c.current_account_id(acc(VAULT))
        .predecessor_account_id(acc(predecessor))
        .attached_deposit(NearToken::from_yoctonear(deposit))
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

fn vault() -> LendVault {
    as_caller(BENEFICIARY);
    LendVault::new(acc(TOKEN), acc(REGISTRY), acc(BENEFICIARY), acc(AGENT), U128(10 * USD), 5000, U128(30 * USD))
}

fn ok<T: near_sdk::serde::Serialize>(value: &T) -> PromiseResult {
    PromiseResult::Successful(serde_json::to_vec(value).unwrap())
}

fn listed(accounts: &[&str]) -> PromiseResult {
    ok(&accounts.iter().map(|a| acc(a)).collect::<Vec<_>>())
}

/// A `get_agent` answer with the fields a business really returns, plus some the vault ignores.
fn agent_view(status: &str, principal: u128, funded: u128) -> PromiseResult {
    ok(&json!({
        "name": "Sample",
        "registry": REGISTRY,
        "token": TOKEN,
        "operator": "someone.testnet",
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
        "now": 1_794_647_814u64
    }))
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

/// Runs a whole lend: the agent's call, then the checked callback with mocked views.
fn lend_through(v: &mut LendVault, amount: u128, principal: u128, funded: u128) {
    as_caller(AGENT);
    let _ = v.lend(acc(BUSINESS), U128(amount), None);
    callback(vec![listed(&[BUSINESS, "sentinel.v1.lien-13569.testnet"]), agent_view("Funding", principal, funded)]);
    let _ = v.on_checked(acc(BUSINESS), U128(amount), Ok(vec![acc(BUSINESS)]), Ok(agent_lite("Funding", principal, funded)));
}

fn agent_lite(status: &str, principal: u128, funded: u128) -> AgentLite {
    match agent_view(status, principal, funded) {
        PromiseResult::Successful(bytes) => serde_json::from_slice(&bytes).unwrap(),
        PromiseResult::Failed => unreachable!(),
    }
}

// ---------- happy path ----------

#[test]
fn lend_asks_the_registry_and_the_business_before_anything_moves() {
    let mut v = vault();
    as_caller(AGENT);
    let _ = v.lend(acc(BUSINESS), U128(5 * USD), None);
    let calls = calls();
    let methods: Vec<_> = calls.iter().map(|c| (c.0.as_str(), c.1.as_str())).collect();
    assert!(methods.contains(&(REGISTRY, "get_agents")));
    assert!(methods.contains(&(BUSINESS, "get_agent")));
    assert!(methods.contains(&(VAULT, "on_checked")));
    assert!(!methods.iter().any(|(_, m)| *m == "ft_transfer_call"), "no money moves before the checks");
    assert_eq!(v.get_totals().in_flight.0, 0);
}

#[test]
fn the_happy_path_sends_ft_transfer_call_with_one_yocto_and_settles() {
    let mut v = vault();
    lend_through(&mut v, 5 * USD, 200 * USD, 0);
    let sent: Vec<_> = calls().into_iter().filter(|c| c.1 == "ft_transfer_call").collect();
    assert_eq!(sent.len(), 1);
    let (receiver, _, args, deposit) = &sent[0];
    assert_eq!(receiver, TOKEN);
    assert_eq!(*deposit, 1, "the vault attaches the 1 yoctoNEAR itself");
    assert_eq!(args["receiver_id"], BUSINESS);
    assert_eq!(args["amount"], (5 * USD).to_string());
    let msg: serde_json::Value = serde_json::from_str(args["msg"].as_str().unwrap()).unwrap();
    assert_eq!(msg, json!({ "action": "fund", "loan_id": 0 }));
    assert_eq!(v.get_totals().in_flight.0, 5 * USD);
    assert_eq!(v.get_totals().budget_left.0, 25 * USD);

    // The token reports that the business kept all of it.
    callback(vec![ok(&U128(5 * USD))]);
    assert_eq!(v.on_lent(acc(BUSINESS), 0, U128(5 * USD), Ok(U128(5 * USD))).0, 5 * USD);
    let t = v.get_totals();
    assert_eq!((t.lent.0, t.in_flight.0, t.refunded.0, t.lends), (5 * USD, 0, 0, 1));
    let p = v.get_position(acc(BUSINESS), 0).unwrap();
    assert_eq!((p.principal.0, p.in_flight.0), (5 * USD, 0));
    assert!(get_logs().iter().any(|l| l.contains("lend_settled")));
}

#[test]
fn a_partial_refund_is_tracked_and_frees_the_budget() {
    let mut v = vault();
    // The loan needed 10 when the vault checked. Another lender's 7 landed while
    // ours was in flight, so the business kept 3 of our 8 and sent 5 back.
    lend_through(&mut v, 8 * USD, 200 * USD, 190 * USD);
    callback(vec![ok(&U128(3 * USD))]);
    v.on_lent(acc(BUSINESS), 0, U128(8 * USD), Ok(U128(3 * USD)));
    let t = v.get_totals();
    assert_eq!((t.lent.0, t.refunded.0, t.in_flight.0), (3 * USD, 5 * USD, 0));
    assert_eq!(t.budget_left.0, 27 * USD);
}

#[test]
fn a_failed_transfer_releases_the_reservation() {
    let mut v = vault();
    lend_through(&mut v, 5 * USD, 200 * USD, 0);
    callback(vec![PromiseResult::Failed]);
    assert_eq!(v.on_lent(acc(BUSINESS), 0, U128(5 * USD), Err(PromiseError::Failed)).0, 0);
    let t = v.get_totals();
    assert_eq!((t.lent.0, t.in_flight.0, t.refunded.0), (0, 0, 5 * USD));
    assert!(v.get_position(acc(BUSINESS), 0).is_none());
    assert_eq!(t.budget_left.0, 30 * USD);
}

#[test]
fn claim_calls_the_business_and_records_the_repayment() {
    let mut v = vault();
    lend_through(&mut v, 5 * USD, 200 * USD, 0);
    callback(vec![ok(&U128(5 * USD))]);
    v.on_lent(acc(BUSINESS), 0, U128(5 * USD), Ok(U128(5 * USD)));

    as_caller(AGENT);
    let _ = v.claim(acc(BUSINESS), 0);
    let c = calls();
    assert!(c.iter().any(|(r, m, a, d)| r == BUSINESS && m == "claim" && a["loan_id"] == 0 && *d == 0));
    callback(vec![ok(&U128(USD / 4))]);
    assert_eq!(v.on_claimed(acc(BUSINESS), 0, Ok(U128(USD / 4))).0, USD / 4);
    assert_eq!(v.get_totals().claimed.0, USD / 4);
    assert_eq!(v.get_position(acc(BUSINESS), 0).unwrap().claimed.0, USD / 4);
}

#[test]
fn foreclose_calls_the_business_with_no_deposit() {
    let mut v = vault();
    lend_through(&mut v, 5 * USD, 200 * USD, 0);
    callback(vec![ok(&U128(5 * USD))]);
    v.on_lent(acc(BUSINESS), 0, U128(5 * USD), Ok(U128(5 * USD)));
    as_caller(AGENT);
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
        assert_eq!(sent[0].0, TOKEN);
        assert_eq!(sent[0].2["receiver_id"], BENEFICIARY);
        assert_eq!(sent[0].3, 1);
        callback(vec![PromiseResult::Successful(vec![])]);
        assert_eq!(v.on_withdrawn(U128(7 * USD)).0, 7 * USD);
        assert_eq!(v.get_totals().withdrawn.0, 7 * USD);
    }
}

#[test]
fn a_failed_withdrawal_is_not_counted() {
    let mut v = vault();
    callback(vec![PromiseResult::Failed]);
    assert_eq!(v.on_withdrawn(U128(7 * USD)).0, 0);
    assert_eq!(v.get_totals().withdrawn.0, 0);
}

#[test]
fn the_policy_is_what_init_set() {
    let v = vault();
    let p = v.get_policy();
    assert_eq!((p.agent.as_str(), p.beneficiary.as_str()), (AGENT, BENEFICIARY));
    assert_eq!((p.max_per_loan.0, p.max_share_bps, p.total_budget.0), (10 * USD, 5000, 30 * USD));
}

// ---------- refusals: paying a non-business ----------

#[test]
#[should_panic(expected = "refused: attacker.testnet is not a Lien business (not an account created under the registry")]
fn lending_to_an_ordinary_account_is_refused() {
    let mut v = vault();
    as_caller(AGENT);
    let _ = v.lend(acc("attacker.testnet"), U128(USD), None);
}

#[test]
#[should_panic(expected = "is not a Lien business (not an account created under the registry")]
fn lending_to_a_deeper_sub_account_is_refused() {
    let mut v = vault();
    as_caller(AGENT);
    let _ = v.lend(acc("x.inject-45089.v1.lien-13569.testnet"), U128(USD), None);
}

#[test]
#[should_panic(expected = "refused: sentinel-x.v1.lien-13569.testnet is not a Lien business (the registry v1.lien-13569.testnet does not list it)")]
fn an_account_under_the_registry_that_it_does_not_list_is_refused() {
    let mut v = vault();
    callback(vec![listed(&[BUSINESS]), agent_view("Funding", 200 * USD, 0)]);
    let _ = v.on_checked(acc("sentinel-x.v1.lien-13569.testnet"), U128(USD), Ok(vec![acc(BUSINESS)]), Ok(agent_lite("Funding", 200 * USD, 0)));
}

#[test]
#[should_panic(expected = "refused: the registry did not answer")]
fn no_answer_from_the_registry_is_a_refusal() {
    let mut v = vault();
    callback(vec![PromiseResult::Failed, agent_view("Funding", 200 * USD, 0)]);
    let _ = v.on_checked(acc(BUSINESS), U128(USD), Err(PromiseError::Failed), Ok(agent_lite("Funding", 200 * USD, 0)));
}

#[test]
#[should_panic(expected = "refused: the business uses another token")]
fn a_business_on_another_token_is_refused() {
    let mut v = vault();
    let mut a = agent_lite("Funding", 200 * USD, 0);
    a.token = acc("fake-usd.testnet");
    callback(vec![]);
    let _ = v.on_checked(acc(BUSINESS), U128(USD), Ok(vec![acc(BUSINESS)]), Ok(a));
}

// ---------- refusals: a loan that is not raising ----------

#[test]
#[should_panic(expected = "is not raising (status Active)")]
fn a_loan_that_is_not_raising_is_refused() {
    let mut v = vault();
    callback(vec![]);
    let _ = v.on_checked(acc(BUSINESS), U128(USD), Ok(vec![acc(BUSINESS)]), Ok(agent_lite("Active", 200 * USD, 200 * USD)));
}

#[test]
#[should_panic(expected = "has no open loan")]
fn a_business_with_no_loan_is_refused() {
    let mut v = vault();
    let mut a = agent_lite("Funding", 200 * USD, 0);
    a.current_loan = None;
    callback(vec![]);
    let _ = v.on_checked(acc(BUSINESS), U128(USD), Ok(vec![acc(BUSINESS)]), Ok(a));
}

// ---------- refusals: above the caps ----------

#[test]
#[should_panic(expected = "refused: 10000001 is above max_per_loan 10000000")]
fn above_max_per_loan_is_refused() {
    let mut v = vault();
    as_caller(AGENT);
    let _ = v.lend(acc(BUSINESS), U128(10 * USD + 1), None);
}

#[test]
#[should_panic(expected = "above max_share_bps 5000 of the principal 10000000 (5000000)")]
fn above_the_share_of_one_loan_is_refused() {
    let mut v = vault();
    callback(vec![]);
    let _ = v.on_checked(acc(BUSINESS), U128(6 * USD), Ok(vec![acc(BUSINESS)]), Ok(agent_lite("Funding", 10 * USD, 0)));
}

#[test]
#[should_panic(expected = "above max_share_bps")]
fn the_share_counts_what_the_vault_already_lent_to_that_loan() {
    let mut v = vault();
    // 40% of a 20 tUSD loan, settled; then 2 tUSD more would be 50% + 0.000001.
    lend_through(&mut v, 8 * USD, 20 * USD, 0);
    callback(vec![ok(&U128(8 * USD))]);
    v.on_lent(acc(BUSINESS), 0, U128(8 * USD), Ok(U128(8 * USD)));
    callback(vec![]);
    let _ = v.on_checked(acc(BUSINESS), U128(2 * USD + 1), Ok(vec![acc(BUSINESS)]), Ok(agent_lite("Funding", 20 * USD, 8 * USD)));
}

#[test]
#[should_panic(expected = "is more than the 2000000 the loan still needs")]
fn more_than_the_loan_needs_is_refused() {
    let mut v = vault();
    callback(vec![]);
    let _ = v.on_checked(acc(BUSINESS), U128(3 * USD), Ok(vec![acc(BUSINESS)]), Ok(agent_lite("Funding", 200 * USD, 198 * USD)));
}

#[test]
#[should_panic(expected = "is above what is left of total_budget (0)")]
fn above_the_total_budget_is_refused() {
    let mut v = vault();
    for i in 0..3 {
        lend_through(&mut v, 10 * USD, 200 * USD, i * 10 * USD);
        callback(vec![ok(&U128(10 * USD))]);
        v.on_lent(acc(BUSINESS), 0, U128(10 * USD), Ok(U128(10 * USD)));
    }
    assert_eq!(v.get_totals().lent.0, 30 * USD);
    as_caller(AGENT);
    let _ = v.lend(acc(BUSINESS), U128(1), None);
}

#[test]
#[should_panic(expected = "is above what is left of total_budget")]
fn money_in_flight_counts_against_the_budget() {
    let mut v = vault();
    // Three lends sent and not settled yet: the fourth is refused before any view.
    for i in 0..3 {
        lend_through(&mut v, 10 * USD, 200 * USD, i * 10 * USD);
    }
    assert_eq!(v.get_totals().in_flight.0, 30 * USD);
    as_caller(AGENT);
    let _ = v.lend(acc(BUSINESS), U128(1), None);
}

// ---------- refusals: who may call, and where money may go ----------

#[test]
#[should_panic(expected = "refused: only the agent lien-lender-645368.testnet can lend")]
fn only_the_agent_can_lend() {
    let mut v = vault();
    as_caller(BENEFICIARY);
    let _ = v.lend(acc(BUSINESS), U128(USD), None);
}

#[test]
#[should_panic(expected = "refused: lend takes no deposit")]
fn lend_takes_no_deposit() {
    let mut v = vault();
    testing_env!(ctx(AGENT, 1).build());
    let _ = v.lend(acc(BUSINESS), U128(USD), None);
}

#[test]
#[should_panic(expected = "refused: callbacks can only be called by the vault itself")]
fn the_callback_that_sends_money_cannot_be_called_from_outside() {
    // The only way to reach ft_transfer_call to an arbitrary account would be to
    // call the callback directly with made-up views. It is private.
    let mut v = vault();
    as_caller(AGENT);
    let _ = v.on_checked(acc("attacker.testnet"), U128(USD), Ok(vec![acc("attacker.testnet")]), Ok(agent_lite("Funding", 200 * USD, 0)));
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

#[test]
#[should_panic(expected = "refused: the vault holds no note on loan 0")]
fn foreclose_only_reaches_businesses_the_vault_lent_to() {
    let mut v = vault();
    as_caller(AGENT);
    let _ = v.foreclose(acc(BUSINESS), 0);
}

#[test]
#[should_panic(expected = "refused: only the agent or the beneficiary can do this")]
fn a_stranger_cannot_claim() {
    let mut v = vault();
    as_caller("attacker.testnet");
    let _ = v.claim(acc(BUSINESS), 0);
}

#[test]
#[should_panic(expected = "total_budget must be at least max_per_loan")]
fn init_rejects_an_inconsistent_policy() {
    as_caller(BENEFICIARY);
    let _ = LendVault::new(acc(TOKEN), acc(REGISTRY), acc(BENEFICIARY), acc(AGENT), U128(10 * USD), 5000, U128(USD));
}

#[test]
fn sub_account_check() {
    let r = acc(REGISTRY);
    assert!(is_direct_sub_account(&acc(BUSINESS), &r));
    assert!(!is_direct_sub_account(&acc(REGISTRY), &r));
    assert!(!is_direct_sub_account(&acc("a.b.v1.lien-13569.testnet"), &r));
    assert!(!is_direct_sub_account(&acc("xv1.lien-13569.testnet"), &r));
    assert!(!is_direct_sub_account(&acc("lien-f4-3863.testnet"), &r));
}
