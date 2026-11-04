//! Unit tests for the rules a lender relies on. Full cross-contract flows are in
//! `tests/integration`.

use crate::math::MAX_AMOUNT;
use crate::types::*;
use crate::AgentContract;
use near_sdk::json_types::U128;
use near_sdk::serde_json::{json, Value};
use near_sdk::test_utils::VMContextBuilder;
use near_sdk::{testing_env, AccountId, Gas, NearToken, PromiseError, PromiseOrValue};

const T0: u64 = 1_000_000;
const HOUR: u64 = 3_600;
const DAY: u64 = 86_400;

fn acc(name: &str) -> AccountId {
    name.parse().unwrap()
}
fn token() -> AccountId {
    acc("usdc.near")
}
fn operator() -> AccountId {
    acc("operator.near")
}
fn vendor() -> AccountId {
    acc("vendor.near")
}
fn alice() -> AccountId {
    acc("alice.near")
}
fn bob() -> AccountId {
    acc("bob.near")
}
fn carol() -> AccountId {
    acc("carol.near")
}

fn ctx(predecessor: AccountId, now: u64) {
    ctx_with(predecessor, now, 0, 300);
}

fn ctx_with(predecessor: AccountId, now: u64, yocto: u128, tgas: u64) {
    testing_env!(VMContextBuilder::new()
        .current_account_id(acc("scout.lien.near"))
        .predecessor_account_id(predecessor)
        .block_timestamp(now * 1_000_000_000)
        .attached_deposit(NearToken::from_yoctonear(yocto))
        .prepaid_gas(Gas::from_tgas(tgas))
        .account_balance(NearToken::from_near(10))
        .build());
}

fn service() -> Service {
    Service {
        wasm: WasmSource {
            url: "https://example.com/agent.wasm".into(),
            hash: "a".repeat(64),
            build_target: "wasm32-wasip2".into(),
        },
        price: U128(1_000),
        max_instructions: 10_000_000_000,
        max_memory_mb: 128,
        max_execution_seconds: 60,
        compute_deposit: NearToken::from_millinear(50),
        secrets_profile: None,
        policy: SpendPolicy {
            vendors: vec![vendor()],
            max_per_tx: U128(500),
            max_per_day: U128(1_000),
        },
    }
}

fn terms() -> LoanTerms {
    LoanTerms {
        principal: U128(100_000),
        total_due: U128(110_000),
        lender_bps: 3_000,
        operator_bps: 2_000,
        funding_secs: DAY,
        term_secs: 30 * DAY,
        window_secs: DAY,
        min_payment_per_window: U128(1_000),
        grace_secs: HOUR,
        auction_secs: DAY,
        auction_reserve_bps: 5_000,
    }
}

fn fresh() -> AgentContract {
    ctx(acc("lien.near"), T0);
    AgentContract::new(
        token(),
        acc("outlayer.near"),
        acc("scout-in.lien.near"),
        operator(),
        "Scout".into(),
        "desc".into(),
        "https://github.com/x/y".into(),
        service(),
    )
}

fn send(c: &mut AgentContract, from: AccountId, amount: u128, msg: Value, now: u64) -> u128 {
    ctx(token(), now);
    match c.ft_on_transfer(from, U128(amount), msg.to_string()) {
        PromiseOrValue::Value(unused) => unused.0,
        PromiseOrValue::Promise(_) => panic!("expected a value"),
    }
}

fn offer(c: &mut AgentContract, t: LoanTerms) -> u32 {
    ctx(operator(), T0);
    c.create_offer(t)
}

/// A business with one fully funded active loan: alice 60%, bob 40%.
fn active() -> AgentContract {
    let mut c = fresh();
    offer(&mut c, terms());
    send(&mut c, alice(), 60_000, json!({"action":"fund","loan_id":0}), T0);
    send(&mut c, bob(), 40_000, json!({"action":"fund","loan_id":0}), T0);
    c
}

fn revenue(c: &mut AgentContract, amount: u128, now: u64) {
    send(c, acc("customer.near"), amount, json!({"action":"revenue"}), now);
}

fn loan(c: &AgentContract) -> Loan {
    c.get_loan(c.loans.len() - 1).unwrap().loan
}

fn job_ok(report: Value) -> Result<Option<Value>, PromiseError> {
    Ok(Some(json!({ "ok": true, "report": report })))
}

fn start_job(c: &mut AgentContract, now: u64) -> u64 {
    let id = c.next_job_id;
    send(c, carol(), 1_000, json!({"action":"job","input":"check bob.near"}), now);
    id
}

// ---------- setup ----------

#[test]
fn starts_with_no_loan_and_an_empty_ledger() {
    let c = fresh();
    assert_eq!(c.ledger.total(), 0);
    assert!(c.current_loan.is_none());
    assert_eq!(c.registry, acc("lien.near"));
}

#[test]
#[should_panic(expected = "the operator cannot be a vendor")]
fn operator_cannot_be_their_own_vendor() {
    ctx(acc("lien.near"), T0);
    let mut s = service();
    s.policy.vendors.push(operator());
    AgentContract::new(token(), acc("o.near"), acc("c.near"), operator(), "x".into(), "".into(), "".into(), s);
}

#[test]
#[should_panic(expected = "wasm hash must be 64 lowercase hex")]
fn rejects_a_bad_hash() {
    ctx(acc("lien.near"), T0);
    let mut s = service();
    s.wasm.hash = "ABC".into();
    AgentContract::new(token(), acc("o.near"), acc("c.near"), operator(), "x".into(), "".into(), "".into(), s);
}

#[test]
#[should_panic(expected = "wasm url must be https")]
fn rejects_a_plain_http_build() {
    ctx(acc("lien.near"), T0);
    let mut s = service();
    s.wasm.url = "http://example.com/a.wasm".into();
    AgentContract::new(token(), acc("o.near"), acc("c.near"), operator(), "x".into(), "".into(), "".into(), s);
}

#[test]
#[should_panic(expected = "price must be above zero")]
fn rejects_a_free_service() {
    ctx(acc("lien.near"), T0);
    let mut s = service();
    s.price = U128(0);
    AgentContract::new(token(), acc("o.near"), acc("c.near"), operator(), "x".into(), "".into(), "".into(), s);
}

// ---------- offers and funding ----------

#[test]
#[should_panic(expected = "only the operator")]
fn strangers_cannot_create_offers() {
    let mut c = fresh();
    ctx(alice(), T0);
    c.create_offer(terms());
}

#[test]
#[should_panic(expected = "not allowed while a loan is open")]
fn only_one_loan_at_a_time() {
    let mut c = fresh();
    offer(&mut c, terms());
    offer(&mut c, terms());
}

macro_rules! bad_terms {
    ($name:ident, $expected:literal, $change:expr) => {
        #[test]
        #[should_panic(expected = $expected)]
        fn $name() {
            let mut c = fresh();
            let mut t = terms();
            let change: fn(&mut LoanTerms) = $change;
            change(&mut t);
            offer(&mut c, t);
        }
    };
}
bad_terms!(zero_principal, "principal must be above zero", |t| t.principal = U128(0));
bad_terms!(due_below_principal, "total_due cannot be below principal", |t| t.total_due = U128(1));
bad_terms!(no_lender_share, "lenders must receive", |t| t.lender_bps = 0);
bad_terms!(shares_over_100, "cannot exceed 100%", |t| { t.lender_bps = 6_000; t.operator_bps = 5_000; });
bad_terms!(window_over_term, "window_secs cannot exceed term_secs", |t| t.window_secs = t.term_secs + 1);
bad_terms!(zero_term, "term_secs must be above zero", |t| t.term_secs = 0);
bad_terms!(huge_due, "above the contract's limit", |t| t.total_due = U128(MAX_AMOUNT + 1));
bad_terms!(min_over_due, "min_payment_per_window cannot exceed", |t| t.min_payment_per_window = U128(t.total_due.0 + 1));
bad_terms!(reserve_over_100, "reserve cannot exceed 100%", |t| t.auction_reserve_bps = 10_001);

#[test]
fn funding_fills_then_activates_and_principal_becomes_working_capital() {
    let mut c = fresh();
    offer(&mut c, terms());
    send(&mut c, alice(), 60_000, json!({"action":"fund","loan_id":0}), T0);
    assert_eq!(loan(&c).status, LoanStatus::Funding);
    assert_eq!(c.ledger.funding_escrow.0, 60_000);
    assert_eq!(c.ledger.opex.0, 0);

    send(&mut c, bob(), 40_000, json!({"action":"fund","loan_id":0}), T0 + 5);
    let l = loan(&c);
    assert_eq!(l.status, LoanStatus::Active);
    assert_eq!(l.activated_at, Some(T0 + 5));
    assert_eq!(l.holders, 2);
    assert_eq!(c.ledger.funding_escrow.0, 0);
    assert_eq!(c.ledger.opex.0, 100_000);
}

#[test]
fn overfunding_returns_the_excess() {
    let mut c = fresh();
    offer(&mut c, terms());
    let unused = send(&mut c, alice(), 150_000, json!({"action":"fund","loan_id":0}), T0);
    assert_eq!(unused, 50_000);
    assert_eq!(c.get_note(0, alice()).unwrap().note.principal.0, 100_000);
    assert_eq!(c.ledger.total(), 100_000);
}

#[test]
#[should_panic(expected = "below the minimum note size")]
fn dust_notes_are_refused() {
    let mut c = fresh();
    offer(&mut c, terms());
    send(&mut c, alice(), 1_999, json!({"action":"fund","loan_id":0}), T0);
}

#[test]
fn a_small_final_chunk_is_allowed_so_a_loan_can_always_fill() {
    let mut c = fresh();
    offer(&mut c, terms());
    send(&mut c, alice(), 99_999, json!({"action":"fund","loan_id":0}), T0);
    send(&mut c, bob(), 1, json!({"action":"fund","loan_id":0}), T0);
    assert_eq!(loan(&c).status, LoanStatus::Active);
}

#[test]
fn the_same_lender_adding_more_is_one_holder() {
    let mut c = fresh();
    offer(&mut c, terms());
    send(&mut c, alice(), 10_000, json!({"action":"fund","loan_id":0}), T0);
    send(&mut c, alice(), 10_000, json!({"action":"fund","loan_id":0}), T0);
    assert_eq!(loan(&c).holders, 1);
    assert_eq!(c.get_note(0, alice()).unwrap().note.principal.0, 20_000);
}

#[test]
#[should_panic(expected = "already has 50 lenders")]
fn lender_count_is_capped_even_when_the_minimum_note_rounds_down() {
    let mut c = fresh();
    let mut t = terms();
    t.principal = U128(149); // 2% rounds down to 2 units, which would allow 74 notes
    t.total_due = U128(149);
    t.min_payment_per_window = U128(0);
    offer(&mut c, t);
    for i in 0..51 {
        send(&mut c, acc(&format!("l{i}.near")), 2, json!({"action":"fund","loan_id":0}), T0);
    }
}

#[test]
#[should_panic(expected = "funding deadline has passed")]
fn late_funding_bounces() {
    let mut c = fresh();
    offer(&mut c, terms());
    send(&mut c, alice(), 10_000, json!({"action":"fund","loan_id":0}), T0 + DAY);
}

#[test]
#[should_panic(expected = "not the one open for funding")]
fn funding_names_the_loan_so_terms_cannot_be_swapped_underneath_a_lender() {
    let mut c = fresh();
    offer(&mut c, terms());
    send(&mut c, alice(), 10_000, json!({"action":"fund","loan_id":7}), T0);
}

#[test]
#[should_panic(expected = "this contract only accepts its configured token")]
fn other_tokens_are_refused() {
    let mut c = fresh();
    ctx(acc("fake.near"), T0);
    let _ = c.ft_on_transfer(alice(), U128(1), json!({"action":"topup"}).to_string());
}

#[test]
#[should_panic(expected = "unrecognised transfer message")]
fn nonsense_messages_bounce() {
    let mut c = fresh();
    ctx(token(), T0);
    let _ = c.ft_on_transfer(alice(), U128(1), "hello".into());
}

#[test]
#[should_panic(expected = "above the contract's limit")]
fn absurd_amounts_bounce() {
    let mut c = fresh();
    ctx(token(), T0);
    let _ = c.ft_on_transfer(alice(), U128(MAX_AMOUNT + 1), json!({"action":"topup"}).to_string());
}

// ---------- cancelling ----------

#[test]
fn cancelling_lets_lenders_claim_their_money_back() {
    let mut c = fresh();
    offer(&mut c, terms());
    send(&mut c, alice(), 30_000, json!({"action":"fund","loan_id":0}), T0);
    ctx(operator(), T0 + 10);
    c.cancel_offer();
    assert_eq!(loan(&c).status, LoanStatus::Cancelled);
    assert!(c.current_loan.is_none());
    assert_eq!(c.ledger.funding_escrow.0, 0);
    assert_eq!(c.ledger.lender_pool.0, 30_000);
    ctx(alice(), T0 + 11);
    assert_eq!(c.claim(0).0, 30_000);
    assert_eq!(c.ledger.lender_pool.0, 0);
}

#[test]
#[should_panic(expected = "only the operator can cancel before")]
fn strangers_cannot_cancel_before_the_deadline() {
    let mut c = fresh();
    offer(&mut c, terms());
    ctx(alice(), T0 + 10);
    c.cancel_offer();
}

#[test]
fn anyone_can_cancel_an_expired_offer() {
    let mut c = fresh();
    offer(&mut c, terms());
    ctx(alice(), T0 + DAY);
    c.cancel_offer();
    assert_eq!(loan(&c).status, LoanStatus::Cancelled);
}

#[test]
#[should_panic(expected = "not accepting funding")]
fn an_active_loan_cannot_be_cancelled() {
    let mut c = active();
    ctx(operator(), T0);
    c.cancel_offer();
}

// ---------- the operator's limits ----------

#[test]
#[should_panic(expected = "not allowed while a loan is open")]
fn operator_cannot_take_the_principal() {
    let mut c = active();
    ctx(operator(), T0);
    c.withdraw_opex(U128(1));
}

#[test]
#[should_panic(expected = "not allowed while a loan is open")]
fn operator_cannot_change_the_code_during_a_loan() {
    let mut c = active();
    ctx(operator(), T0);
    let mut s = service();
    s.wasm.hash = "b".repeat(64);
    c.update_service(s);
}

#[test]
#[should_panic(expected = "not allowed while a loan is open")]
fn the_code_freezes_from_the_moment_of_the_offer() {
    let mut c = fresh();
    offer(&mut c, terms());
    ctx(operator(), T0);
    c.update_service(service());
}

#[test]
#[should_panic(expected = "not allowed while a loan is open")]
fn operator_cannot_sell_the_business_out_from_under_a_loan() {
    let mut c = active();
    ctx_with(operator(), T0, 1, 300);
    c.transfer_operator(bob());
}

#[test]
#[should_panic(expected = "not allowed while a loan is open")]
fn operator_cannot_drain_the_compute_tank_during_a_loan() {
    let mut c = active();
    ctx(operator(), T0);
    c.withdraw_tank(NearToken::from_near(1));
}

#[test]
fn with_no_loan_the_operator_has_full_control() {
    let mut c = fresh();
    send(&mut c, carol(), 5_000, json!({"action":"revenue"}), T0);
    assert_eq!(c.ledger.opex.0, 5_000);
    ctx(operator(), T0);
    c.withdraw_opex(U128(2_000));
    assert_eq!(c.ledger.opex.0, 3_000);
    let mut s = service();
    s.price = U128(9);
    c.update_service(s);
    assert_eq!(c.service.price.0, 9);
}

#[test]
#[should_panic(expected = "not allowed while a loan is open")]
fn secrets_cannot_change_during_a_loan() {
    let mut c = active();
    ctx(operator(), T0);
    let _ = c.store_secrets(json!({}), "p".into(), "x".into(), json!("AllowAll"));
}

#[test]
#[should_panic(expected = "only the operator")]
fn strangers_cannot_set_secrets() {
    let mut c = fresh();
    ctx(alice(), T0);
    let _ = c.store_secrets(json!({}), "p".into(), "x".into(), json!("AllowAll"));
}

// ---------- the waterfall ----------

#[test]
fn revenue_splits_between_lenders_operator_and_opex() {
    let mut c = active();
    revenue(&mut c, 10_000, T0 + 10);
    assert_eq!(loan(&c).repaid.0, 3_000);
    assert_eq!(c.ledger.lender_pool.0, 3_000);
    assert_eq!(c.ledger.operator.0, 2_000);
    assert_eq!(c.ledger.opex.0, 105_000);
}

#[test]
fn the_last_payment_closes_the_loan_and_the_rest_stays_in_the_business() {
    let mut c = active();
    ctx(operator(), T0 + 1);
    c.repay_from_opex(U128(100_000));
    send(&mut c, alice(), 9_000, json!({"action":"repay"}), T0 + 1);
    assert_eq!(loan(&c).repaid.0, 109_000);
    assert_eq!(c.ledger.opex.0, 0);
    revenue(&mut c, 10_000, T0 + 2);
    let l = loan(&c);
    assert_eq!(l.status, LoanStatus::Repaid);
    assert_eq!(l.repaid.0, 110_000);
    assert!(c.current_loan.is_none());
}

#[test]
fn repaying_more_than_is_owed_returns_the_rest() {
    let mut c = active();
    let unused = send(&mut c, alice(), 200_000, json!({"action":"repay"}), T0 + 1);
    assert_eq!(unused, 90_000);
    assert_eq!(loan(&c).status, LoanStatus::Repaid);
}

#[test]
fn after_repayment_the_operator_is_free_again() {
    let mut c = active();
    send(&mut c, alice(), 110_000, json!({"action":"repay"}), T0 + 1);
    ctx(operator(), T0 + 2);
    c.withdraw_opex(U128(100_000));
    assert_eq!(c.ledger.opex.0, 0);
    c.update_service(service());
    offer(&mut c, terms());
    assert_eq!(loan(&c).id, 1);
}

#[test]
fn revenue_during_funding_is_just_working_capital() {
    let mut c = fresh();
    offer(&mut c, terms());
    revenue(&mut c, 500, T0);
    assert_eq!(c.ledger.opex.0, 500);
    assert_eq!(c.ledger.lender_pool.0, 0);
}

#[test]
fn operator_can_withdraw_their_share_while_current() {
    let mut c = active();
    revenue(&mut c, 10_000, T0 + 10);
    ctx(operator(), T0 + 11);
    c.withdraw_operator(None);
    assert_eq!(c.ledger.operator.0, 0);
}

#[test]
#[should_panic(expected = "not enough balance")]
fn operator_cannot_withdraw_more_than_their_share() {
    let mut c = active();
    revenue(&mut c, 10_000, T0 + 10);
    ctx(operator(), T0 + 11);
    c.withdraw_operator(Some(U128(2_001)));
}

// ---------- falling behind ----------

#[test]
#[should_panic(expected = "locked while behind")]
fn the_operator_share_locks_as_soon_as_payments_fall_behind() {
    let mut c = active();
    revenue(&mut c, 10_000, T0 + 10); // lenders get 3,000, covering 3 windows
    ctx(operator(), T0 + 4 * DAY);
    c.withdraw_operator(None);
}

#[test]
fn while_behind_the_operator_share_goes_to_lenders() {
    let mut c = active();
    revenue(&mut c, 1_000, T0 + 2 * DAY);
    assert_eq!(loan(&c).repaid.0, 500);
    assert_eq!(c.ledger.operator.0, 0);
    assert_eq!(c.ledger.opex.0, 100_500);
}

#[test]
fn catching_up_unlocks_the_operator_share_with_no_extra_step() {
    let mut c = active();
    revenue(&mut c, 10_000, T0 + 10);
    assert!(!c.is_trapped());
    ctx(token(), T0 + 4 * DAY);
    assert!(c.is_trapped());
    send(&mut c, alice(), 5_000, json!({"action":"repay"}), T0 + 4 * DAY);
    ctx(operator(), T0 + 4 * DAY);
    c.withdraw_operator(None);
    assert_eq!(c.ledger.operator.0, 0);
}

// ---------- foreclosure ----------

#[test]
#[should_panic(expected = "current or still inside the grace period")]
fn cannot_foreclose_a_current_loan() {
    let mut c = active();
    ctx(alice(), T0 + 10);
    c.foreclose();
}

#[test]
#[should_panic(expected = "current or still inside the grace period")]
fn cannot_foreclose_during_grace() {
    let mut c = active();
    ctx(alice(), T0 + DAY + HOUR - 1);
    c.foreclose();
}

#[test]
#[should_panic(expected = "current or still inside the grace period")]
fn a_payment_during_grace_stops_foreclosure() {
    let mut c = active();
    send(&mut c, operator(), 1_000, json!({"action":"repay"}), T0 + DAY + 10);
    ctx(alice(), T0 + DAY + HOUR);
    c.foreclose();
}

#[test]
fn anyone_can_foreclose_after_grace_and_the_clock_needs_no_keeper() {
    let mut c = active();
    ctx(acc("anyone.near"), T0 + DAY + HOUR);
    c.foreclose();
    let l = loan(&c);
    assert_eq!(l.status, LoanStatus::Foreclosed);
    assert_eq!(l.foreclosed_at, Some(T0 + DAY + HOUR));
}

#[test]
fn foreclosure_seizes_the_operator_share_and_idle_capital_but_keeps_a_runway() {
    let mut c = active();
    revenue(&mut c, 2_000, T0 + 10); // lender 600, operator 400, opex 1,000
    ctx(alice(), T0 + DAY + HOUR);
    c.foreclose();
    // Runway is 7 days of the 1,000 daily limit. The rest of opex goes to lenders.
    assert_eq!(c.ledger.operator.0, 0);
    assert_eq!(c.ledger.opex.0, 7_000);
    assert_eq!(loan(&c).repaid.0, 600 + 400 + 101_000 - 7_000);
    assert_eq!(c.ledger.lender_pool.0, 95_000);
}

#[test]
fn a_foreclosed_business_keeps_earning_for_lenders() {
    let mut c = active();
    ctx(alice(), T0 + DAY + HOUR);
    c.foreclose();
    let repaid = loan(&c).repaid.0;
    revenue(&mut c, 1_000, T0 + 2 * DAY);
    assert_eq!(loan(&c).repaid.0, repaid + 500);
    assert_eq!(c.ledger.operator.0, 0);
}

#[test]
#[should_panic(expected = "locked while behind")]
fn a_foreclosed_operator_cannot_withdraw() {
    let mut c = active();
    ctx(alice(), T0 + DAY + HOUR);
    c.foreclose();
    ctx(operator(), T0 + DAY + HOUR);
    c.withdraw_operator(None);
}

#[test]
#[should_panic(expected = "not allowed while a loan is open")]
fn a_foreclosed_operator_cannot_touch_the_code() {
    let mut c = active();
    ctx(alice(), T0 + DAY + HOUR);
    c.foreclose();
    ctx(operator(), T0 + DAY + HOUR);
    c.update_service(service());
}

#[test]
fn foreclosure_can_itself_clear_the_debt_when_enough_capital_was_idle() {
    let mut c = fresh();
    let mut t = terms();
    t.total_due = t.principal;
    offer(&mut c, t);
    send(&mut c, alice(), 100_000, json!({"action":"fund","loan_id":0}), T0);
    send(&mut c, carol(), 50_000, json!({"action":"topup"}), T0);
    ctx(alice(), T0 + DAY + HOUR);
    c.foreclose();
    assert_eq!(loan(&c).status, LoanStatus::Repaid);
    assert!(c.current_loan.is_none());
    assert_eq!(c.operator, operator());
}

/// A foreclosed business with idle capital spent down, so real debt remains.
fn foreclosed() -> AgentContract {
    let mut c = fresh();
    let mut s = service();
    s.policy.max_per_day = U128(1_000_000);
    s.policy.max_per_tx = U128(1_000_000);
    ctx(operator(), T0);
    c.update_service(s);
    offer(&mut c, terms());
    send(&mut c, alice(), 60_000, json!({"action":"fund","loan_id":0}), T0);
    send(&mut c, bob(), 40_000, json!({"action":"fund","loan_id":0}), T0);
    ctx(alice(), T0 + DAY + HOUR);
    c.foreclose();
    assert_eq!(c.get_loan(0).unwrap().outstanding.0, 110_000);
    c
}

#[test]
fn the_operator_can_redeem_by_paying_in_full() {
    let mut c = foreclosed();
    send(&mut c, operator(), 110_000, json!({"action":"repay"}), T0 + 2 * DAY);
    let l = loan(&c);
    assert_eq!(l.status, LoanStatus::Repaid);
    assert_eq!(c.operator, operator());
    assert!(c.current_loan.is_none());
}

// ---------- the auction ----------

#[test]
#[should_panic(expected = "not in foreclosure")]
fn cannot_bid_on_a_healthy_business() {
    let mut c = active();
    send(&mut c, carol(), 100_000, json!({"action":"bid"}), T0 + 1);
}

#[test]
#[should_panic(expected = "the lowest acceptable bid is 55000")]
fn first_bid_must_meet_the_reserve() {
    let mut c = foreclosed();
    send(&mut c, carol(), 54_999, json!({"action":"bid"}), T0 + 2 * DAY);
}

#[test]
#[should_panic(expected = "the lowest acceptable bid is 63000")]
fn next_bid_must_beat_the_last_by_five_percent() {
    let mut c = foreclosed();
    send(&mut c, carol(), 60_000, json!({"action":"bid"}), T0 + 2 * DAY);
    send(&mut c, bob(), 62_999, json!({"action":"bid"}), T0 + 2 * DAY);
}

#[test]
fn outbid_bidders_get_their_money_back() {
    let mut c = foreclosed();
    send(&mut c, carol(), 60_000, json!({"action":"bid"}), T0 + 2 * DAY);
    assert_eq!(c.ledger.auction_escrow.0, 60_000);
    send(&mut c, bob(), 70_000, json!({"action":"bid"}), T0 + 2 * DAY);
    assert_eq!(c.ledger.auction_escrow.0, 70_000);
    // The refund was pushed out, so it is no longer held as a credit.
    assert_eq!(c.get_credit(carol()).0, 0);
    assert_eq!(c.ledger.credits.0, 0);
}

#[test]
fn a_refund_stays_as_a_credit_when_there_is_no_gas_to_push_it() {
    let mut c = foreclosed();
    send(&mut c, carol(), 60_000, json!({"action":"bid"}), T0 + 2 * DAY);
    ctx_with(token(), T0 + 2 * DAY, 0, 10);
    let _ = c.ft_on_transfer(bob(), U128(70_000), json!({"action":"bid"}).to_string());
    assert_eq!(c.get_credit(carol()).0, 60_000);
    assert_eq!(c.ledger.credits.0, 60_000);
    ctx(acc("anyone.near"), T0 + 2 * DAY);
    c.withdraw(carol());
    assert_eq!(c.get_credit(carol()).0, 0);
}

#[test]
fn a_failed_payout_restores_the_credit() {
    let mut c = foreclosed();
    testing_env!(
        VMContextBuilder::new()
            .current_account_id(acc("scout.lien.near"))
            .predecessor_account_id(acc("scout.lien.near"))
            .prepaid_gas(Gas::from_tgas(300))
            .build(),
        near_sdk::test_vm_config(),
        near_sdk::RuntimeFeesConfig::test(),
        Default::default(),
        vec![near_sdk::PromiseResult::Failed]
    );
    c.on_push(carol(), U128(777));
    assert_eq!(c.get_credit(carol()).0, 777);
    assert_eq!(c.ledger.credits.0, 777);
}

#[test]
fn a_late_bid_extends_the_auction_so_it_cannot_be_sniped() {
    let mut c = foreclosed();
    let t = T0 + 2 * DAY;
    send(&mut c, carol(), 60_000, json!({"action":"bid"}), t);
    let ends = loan(&c).auction.ends_at.unwrap();
    assert_eq!(ends, t + DAY);
    send(&mut c, bob(), 70_000, json!({"action":"bid"}), ends - 1);
    assert_eq!(loan(&c).auction.ends_at, Some(ends - 1 + 600));
}

#[test]
#[should_panic(expected = "the auction has ended")]
fn bids_after_the_end_bounce() {
    let mut c = foreclosed();
    let t = T0 + 2 * DAY;
    send(&mut c, carol(), 60_000, json!({"action":"bid"}), t);
    send(&mut c, bob(), 90_000, json!({"action":"bid"}), t + DAY);
}

#[test]
#[should_panic(expected = "too early")]
fn cannot_settle_before_the_end() {
    let mut c = foreclosed();
    let t = T0 + 2 * DAY;
    send(&mut c, carol(), 60_000, json!({"action":"bid"}), t);
    ctx(carol(), t + DAY - 1);
    c.settle_auction();
}

#[test]
#[should_panic(expected = "the auction has no bids")]
fn cannot_settle_without_bids() {
    let mut c = foreclosed();
    ctx(carol(), T0 + 100 * DAY);
    c.settle_auction();
}

#[test]
fn a_sale_below_the_debt_pays_lenders_and_transfers_the_business() {
    let mut c = foreclosed();
    let t = T0 + 2 * DAY;
    send(&mut c, carol(), 60_000, json!({"action":"bid"}), t);
    ctx(acc("anyone.near"), t + DAY);
    c.settle_auction();
    let l = loan(&c);
    assert_eq!(l.status, LoanStatus::Sold);
    assert_eq!(l.repaid.0, 60_000);
    assert_eq!(c.operator, carol());
    assert!(c.current_loan.is_none());
    assert_eq!(c.ledger.auction_escrow.0, 0);
    assert_eq!(c.ledger.lender_pool.0, 60_000);
    // Lenders claim pro rata: alice 60%, bob 40%.
    ctx(alice(), t + DAY);
    assert_eq!(c.claim(0).0, 36_000);
    ctx(bob(), t + DAY);
    assert_eq!(c.claim(0).0, 24_000);
}

#[test]
fn a_sale_above_the_debt_returns_the_surplus_to_the_former_operator() {
    let mut c = foreclosed();
    let t = T0 + 2 * DAY;
    ctx_with(token(), t, 0, 10);
    let _ = c.ft_on_transfer(carol(), U128(150_000), json!({"action":"bid"}).to_string());
    ctx_with(acc("anyone.near"), t + DAY, 0, 10);
    c.settle_auction();
    assert_eq!(loan(&c).repaid.0, 110_000);
    assert_eq!(c.get_credit(operator()).0, 40_000);
    assert_eq!(c.ledger.lender_pool.0, 110_000);
}

#[test]
fn the_buyer_has_full_control_afterwards() {
    let mut c = foreclosed();
    let t = T0 + 2 * DAY;
    send(&mut c, carol(), 60_000, json!({"action":"bid"}), t);
    ctx(acc("anyone.near"), t + DAY);
    c.settle_auction();
    ctx(carol(), t + DAY);
    let mut s = service();
    s.price = U128(42);
    c.update_service(s);
    assert_eq!(c.service.price.0, 42);
    c.withdraw_opex(U128(1));
}

#[test]
#[should_panic(expected = "only the operator")]
fn the_former_operator_has_no_control_after_a_sale() {
    let mut c = foreclosed();
    let t = T0 + 2 * DAY;
    send(&mut c, carol(), 60_000, json!({"action":"bid"}), t);
    ctx(acc("anyone.near"), t + DAY);
    c.settle_auction();
    ctx(operator(), t + DAY);
    c.update_service(service());
}

#[test]
fn a_vendor_who_buys_the_business_stops_being_a_vendor() {
    let mut c = foreclosed();
    let t = T0 + 2 * DAY;
    send(&mut c, vendor(), 60_000, json!({"action":"bid"}), t);
    ctx(acc("anyone.near"), t + DAY);
    c.settle_auction();
    assert!(!c.service.policy.vendors.contains(&vendor()));
}

#[test]
fn redeeming_during_an_auction_refunds_the_bidder_and_cancels_the_sale() {
    let mut c = foreclosed();
    let t = T0 + 2 * DAY;
    ctx_with(token(), t, 0, 10);
    let _ = c.ft_on_transfer(carol(), U128(60_000), json!({"action":"bid"}).to_string());
    ctx_with(token(), t + 10, 0, 10);
    let _ = c.ft_on_transfer(operator(), U128(110_000), json!({"action":"repay"}).to_string());
    assert_eq!(loan(&c).status, LoanStatus::Repaid);
    assert_eq!(c.operator, operator());
    assert_eq!(c.ledger.auction_escrow.0, 0);
    assert_eq!(c.get_credit(carol()).0, 60_000);
}

#[test]
#[should_panic(expected = "there is no open loan")]
fn a_settled_sale_cannot_be_settled_twice() {
    let mut c = foreclosed();
    let t = T0 + 2 * DAY;
    send(&mut c, carol(), 60_000, json!({"action":"bid"}), t);
    ctx(acc("anyone.near"), t + DAY);
    c.settle_auction();
    c.settle_auction();
}

// ---------- jobs ----------

#[test]
fn a_job_holds_the_payment_until_it_finishes() {
    let mut c = active();
    let opex = c.ledger.opex.0;
    let id = start_job(&mut c, T0 + 10);
    assert_eq!(c.ledger.job_escrow.0, 1_000);
    assert_eq!(c.pending_jobs, 1);
    assert_eq!(c.ledger.opex.0, opex);
    assert_eq!(c.get_job(id).unwrap().status, JobStatus::Pending);
    assert_eq!(c.stats.unique_payers, 1);
}

#[test]
fn a_finished_job_becomes_revenue_and_stores_the_report() {
    let mut c = active();
    let id = start_job(&mut c, T0 + 10);
    ctx(acc("scout.lien.near"), T0 + 20);
    c.on_job_result(id, job_ok(json!({"risk":"low"})));
    let job = c.get_job(id).unwrap();
    assert_eq!(job.status, JobStatus::Done);
    assert_eq!(job.report.as_deref(), Some(r#"{"risk":"low"}"#));
    assert_eq!(job.wasm_hash, "a".repeat(64));
    assert_eq!(c.ledger.job_escrow.0, 0);
    assert_eq!(c.pending_jobs, 0);
    assert_eq!(c.stats.jobs_done, 1);
    assert_eq!(c.stats.job_revenue.0, 1_000);
    assert_eq!(loan(&c).repaid.0, 300);
    assert_eq!(c.ledger.operator.0, 200);
}

#[test]
fn overpaying_for_a_job_returns_the_difference() {
    let mut c = active();
    let unused = send(&mut c, carol(), 1_500, json!({"action":"job","input":"x"}), T0);
    assert_eq!(unused, 500);
    assert_eq!(c.ledger.job_escrow.0, 1_000);
}

#[test]
#[should_panic(expected = "below the price")]
fn underpaying_for_a_job_bounces() {
    let mut c = active();
    send(&mut c, carol(), 999, json!({"action":"job","input":"x"}), T0);
}

#[test]
#[should_panic(expected = "input is above 2048 bytes")]
fn oversized_input_bounces() {
    let mut c = active();
    send(&mut c, carol(), 1_000, json!({"action":"job","input":"x".repeat(2_049)}), T0);
}

fn assert_refunded(c: &AgentContract, id: u64) {
    assert_eq!(c.get_job(id).unwrap().status, JobStatus::Refunded);
    assert_eq!(c.ledger.job_escrow.0, 0);
    assert_eq!(c.pending_jobs, 0);
    assert_eq!(c.stats.jobs_refunded, 1);
    assert_eq!(c.stats.jobs_done, 0);
    assert_eq!(c.stats.job_revenue.0, 0);
    assert_eq!(c.loan(0).repaid.0, 0);
}

#[test]
fn a_failed_run_refunds_the_customer() {
    let mut c = active();
    let id = start_job(&mut c, T0 + 10);
    ctx(acc("scout.lien.near"), T0 + 20);
    c.on_job_result(id, Err(PromiseError::Failed));
    assert_refunded(&c, id);
}

#[test]
fn a_run_with_no_output_refunds_the_customer() {
    let mut c = active();
    let id = start_job(&mut c, T0 + 10);
    ctx(acc("scout.lien.near"), T0 + 20);
    c.on_job_result(id, Ok(None));
    assert_refunded(&c, id);
}

#[test]
fn malformed_output_refunds_the_customer_rather_than_panicking() {
    let mut c = active();
    let id = start_job(&mut c, T0 + 10);
    ctx(acc("scout.lien.near"), T0 + 20);
    c.on_job_result(id, Ok(Some(json!("not the expected shape"))));
    assert_refunded(&c, id);
}

#[test]
fn an_agent_declining_a_job_refunds_the_customer() {
    let mut c = active();
    let id = start_job(&mut c, T0 + 10);
    ctx(acc("scout.lien.near"), T0 + 20);
    c.on_job_result(id, Ok(Some(json!({"ok":false,"report":"bad input"}))));
    assert_refunded(&c, id);
}

#[test]
fn an_oversized_report_refunds_the_customer() {
    let mut c = active();
    let id = start_job(&mut c, T0 + 10);
    ctx(acc("scout.lien.near"), T0 + 20);
    c.on_job_result(id, job_ok(json!("x".repeat(1_100))));
    assert_refunded(&c, id);
}

#[test]
fn a_late_result_after_expiry_changes_nothing() {
    let mut c = active();
    let id = start_job(&mut c, T0 + 10);
    ctx(acc("anyone.near"), T0 + 10 + HOUR);
    c.expire_job(id);
    assert_refunded(&c, id);
    ctx(acc("scout.lien.near"), T0 + 10 + HOUR + 1);
    c.on_job_result(id, job_ok(json!({"risk":"low"})));
    assert_refunded(&c, id);
}

#[test]
#[should_panic(expected = "too early")]
fn jobs_cannot_be_expired_early() {
    let mut c = active();
    let id = start_job(&mut c, T0 + 10);
    ctx(acc("anyone.near"), T0 + 10 + HOUR - 1);
    c.expire_job(id);
}

#[test]
#[should_panic(expected = "not pending")]
fn a_finished_job_cannot_be_expired() {
    let mut c = active();
    let id = start_job(&mut c, T0 + 10);
    ctx(acc("scout.lien.near"), T0 + 20);
    c.on_job_result(id, job_ok(json!(1)));
    ctx(acc("anyone.near"), T0 + 2 * HOUR);
    c.expire_job(id);
}

#[test]
fn a_repeated_result_is_not_counted_twice() {
    let mut c = active();
    let id = start_job(&mut c, T0 + 10);
    ctx(acc("scout.lien.near"), T0 + 20);
    c.on_job_result(id, job_ok(json!(1)));
    c.on_job_result(id, job_ok(json!(1)));
    assert_eq!(c.stats.jobs_done, 1);
    assert_eq!(c.stats.job_revenue.0, 1_000);
}

#[test]
#[should_panic(expected = "out of compute funds")]
fn an_empty_tank_bounces_the_payment_instead_of_taking_it() {
    let mut c = active();
    testing_env!(VMContextBuilder::new()
        .current_account_id(acc("scout.lien.near"))
        .predecessor_account_id(token())
        .block_timestamp(T0 * 1_000_000_000)
        .prepaid_gas(Gas::from_tgas(300))
        .account_balance(NearToken::from_millinear(1))
        .build());
    let _ = c.ft_on_transfer(carol(), U128(1_000), json!({"action":"job","input":"x"}).to_string());
}

#[test]
#[should_panic(expected = "too many jobs in progress")]
fn pending_jobs_are_capped() {
    let mut c = active();
    for _ in 0..65 {
        start_job(&mut c, T0);
    }
}

#[test]
fn repeat_customers_count_once() {
    let mut c = active();
    start_job(&mut c, T0);
    start_job(&mut c, T0);
    assert_eq!(c.stats.unique_payers, 1);
}

#[test]
fn old_finished_jobs_are_dropped_to_keep_storage_bounded() {
    let mut c = active();
    let first = start_job(&mut c, T0);
    ctx(acc("scout.lien.near"), T0);
    c.on_job_result(first, job_ok(json!(1)));
    for _ in 0..200 {
        let id = start_job(&mut c, T0);
        ctx(acc("scout.lien.near"), T0);
        c.on_job_result(id, job_ok(json!(1)));
    }
    assert!(c.get_job(first).is_none());
    assert!(c.get_job(first + 1).is_some());
}

// ---------- spending ----------

fn run_with_spends(c: &mut AgentContract, spends: Value, now: u64) -> u64 {
    let id = start_job(c, now);
    ctx(acc("scout.lien.near"), now);
    c.on_job_result(id, Ok(Some(json!({"ok":true,"report":1,"spends":spends}))));
    id
}

#[test]
fn the_agent_can_pay_an_approved_vendor() {
    let mut c = active();
    let before = c.ledger.opex.0;
    run_with_spends(&mut c, json!([{"to":"vendor.near","amount":"200"}]), T0);
    assert_eq!(c.stats.spent.0, 200);
    assert_eq!(c.stats.spends_blocked, 0);
    // Job revenue adds 500 to opex after lenders and the operator take theirs.
    assert_eq!(c.ledger.opex.0, before + 500 - 200);
}

#[test]
fn every_kind_of_bad_spend_is_blocked_and_the_job_still_counts() {
    let mut c = active();
    let spends = json!([
        {"to":"thief.near","amount":"100"},
        {"to":"vendor.near","amount":"501"},
        {"to":"NOT VALID","amount":"1"},
    ]);
    let id = run_with_spends(&mut c, spends, T0);
    assert_eq!(c.stats.spends_blocked, 3);
    assert_eq!(c.stats.spent.0, 0);
    assert_eq!(c.get_job(id).unwrap().status, JobStatus::Done);
}

#[test]
fn compromised_code_cannot_pay_the_operator() {
    let mut c = active();
    run_with_spends(&mut c, json!([{"to":"operator.near","amount":"100"}]), T0);
    assert_eq!(c.stats.spends_blocked, 1);
    assert_eq!(c.stats.spent.0, 0);
}

#[test]
fn zero_spends_are_blocked() {
    let mut c = active();
    run_with_spends(&mut c, json!([{"to":"vendor.near","amount":"0"}]), T0);
    assert_eq!(c.stats.spends_blocked, 1);
}

#[test]
fn the_daily_limit_holds_across_jobs_and_resets_the_next_day() {
    let mut c = active();
    run_with_spends(&mut c, json!([{"to":"vendor.near","amount":"500"},{"to":"vendor.near","amount":"500"}]), T0);
    assert_eq!(c.stats.spent.0, 1_000);
    run_with_spends(&mut c, json!([{"to":"vendor.near","amount":"1"}]), T0 + 1);
    assert_eq!(c.stats.spends_blocked, 1);
    assert_eq!(c.stats.spent.0, 1_000);
    run_with_spends(&mut c, json!([{"to":"vendor.near","amount":"1"}]), T0 + DAY);
    assert_eq!(c.stats.spent.0, 1_001);
}

#[test]
fn only_three_spends_are_honoured_per_job() {
    let mut c = active();
    let s = json!({"to":"vendor.near","amount":"10"});
    run_with_spends(&mut c, json!([s, s, s, s, s]), T0);
    assert_eq!(c.stats.spent.0, 30);
}

#[test]
fn spending_cannot_exceed_working_capital() {
    let mut c = fresh();
    run_with_spends(&mut c, json!([{"to":"vendor.near","amount":"500"}]), T0);
    // The job's own 1,000 arrived first, so that spend was covered.
    assert_eq!(c.stats.spent.0, 500);
    ctx(operator(), T0);
    c.withdraw_opex(U128(500));
    let id = start_job(&mut c, T0 + 1);
    ctx(acc("scout.lien.near"), T0 + 1);
    let spends = json!([{"to":"vendor.near","amount":"500"},{"to":"vendor.near","amount":"500"},{"to":"vendor.near","amount":"500"}]);
    c.on_job_result(id, Ok(Some(json!({"ok":true,"spends":spends}))));
    // 500 of today's 1,000 was already spent, so only one more 500 passes.
    assert_eq!(c.stats.spent.0, 1_000);
    assert_eq!(c.stats.spends_blocked, 2);
}

// ---------- notes ----------

#[test]
fn lenders_claim_in_proportion_to_their_note() {
    let mut c = active();
    revenue(&mut c, 10_000, T0 + 10); // lenders get 3,000
    ctx(alice(), T0 + 11);
    assert_eq!(c.claim(0).0, 1_800);
    ctx(bob(), T0 + 11);
    assert_eq!(c.claim(0).0, 1_200);
    assert_eq!(c.ledger.lender_pool.0, 0);
}

#[test]
#[should_panic(expected = "nothing to claim")]
fn claiming_twice_gets_nothing() {
    let mut c = active();
    revenue(&mut c, 10_000, T0 + 10);
    ctx(alice(), T0 + 11);
    c.claim(0);
    c.claim(0);
}

#[test]
#[should_panic(expected = "nothing to claim")]
fn strangers_have_nothing_to_claim() {
    let mut c = active();
    revenue(&mut c, 10_000, T0 + 10);
    ctx(carol(), T0 + 11);
    c.claim(0);
}

#[test]
fn a_transferred_note_carries_its_history() {
    let mut c = active();
    revenue(&mut c, 10_000, T0 + 10);
    ctx(alice(), T0 + 11);
    c.claim(0);
    ctx_with(alice(), T0 + 12, 1, 300);
    c.transfer_note(0, carol());
    assert!(c.get_note(0, alice()).is_none());
    // Carol cannot re-claim what alice already took.
    assert_eq!(c.get_note(0, carol()).unwrap().claimable.0, 0);
    revenue(&mut c, 10_000, T0 + 13);
    assert_eq!(c.get_note(0, carol()).unwrap().claimable.0, 1_800);
}

#[test]
fn merging_notes_keeps_the_holder_count_right() {
    let mut c = active();
    ctx_with(alice(), T0, 1, 300);
    c.transfer_note(0, bob());
    assert_eq!(loan(&c).holders, 1);
    assert_eq!(c.get_note(0, bob()).unwrap().note.principal.0, 100_000);
}

#[test]
#[should_panic(expected = "Requires attached deposit of exactly 1 yoctoNEAR")]
fn transferring_a_note_needs_a_full_access_key() {
    let mut c = active();
    ctx(alice(), T0);
    c.transfer_note(0, carol());
}

#[test]
#[should_panic(expected = "cannot transfer a note to yourself")]
fn self_transfer_is_refused() {
    let mut c = active();
    ctx_with(alice(), T0, 1, 300);
    c.transfer_note(0, alice());
}

// ---------- voting on changes ----------

fn new_code() -> Service {
    let mut s = service();
    s.wasm.hash = "b".repeat(64);
    s
}

#[test]
fn a_change_applies_only_when_more_than_half_of_principal_agrees() {
    let mut c = active(); // alice 60%, bob 40%
    ctx(operator(), T0);
    let id = c.propose_change(new_code());
    ctx(bob(), T0);
    c.approve_change(id);
    assert_eq!(c.service.wasm.hash, "a".repeat(64));
    ctx(alice(), T0);
    c.approve_change(id);
    assert_eq!(c.service.wasm.hash, "b".repeat(64));
    assert!(c.proposal.is_none());
}

#[test]
fn exactly_half_is_not_enough() {
    let mut c = fresh();
    offer(&mut c, terms());
    send(&mut c, alice(), 50_000, json!({"action":"fund","loan_id":0}), T0);
    send(&mut c, bob(), 50_000, json!({"action":"fund","loan_id":0}), T0);
    ctx(operator(), T0);
    let id = c.propose_change(new_code());
    ctx(alice(), T0);
    c.approve_change(id);
    assert_eq!(c.service.wasm.hash, "a".repeat(64));
}

#[test]
#[should_panic(expected = "already voted")]
fn a_note_votes_once() {
    let mut c = active();
    ctx(operator(), T0);
    let id = c.propose_change(new_code());
    ctx(bob(), T0);
    c.approve_change(id);
    c.approve_change(id);
}

#[test]
#[should_panic(expected = "voted on an open proposal")]
fn the_same_principal_cannot_vote_twice_by_moving_the_note() {
    let mut c = active();
    ctx(operator(), T0);
    let id = c.propose_change(new_code());
    ctx(bob(), T0);
    c.approve_change(id);
    ctx_with(bob(), T0, 1, 300);
    c.transfer_note(0, carol());
}

#[test]
#[should_panic(expected = "voted on an open proposal")]
fn a_voted_note_cannot_receive_more_principal_either() {
    let mut c = active();
    ctx(operator(), T0);
    let id = c.propose_change(new_code());
    ctx(bob(), T0);
    c.approve_change(id);
    ctx_with(alice(), T0, 1, 300);
    c.transfer_note(0, bob());
}

#[test]
#[should_panic(expected = "this account holds no note")]
fn strangers_cannot_vote() {
    let mut c = active();
    ctx(operator(), T0);
    let id = c.propose_change(new_code());
    ctx(carol(), T0);
    c.approve_change(id);
}

#[test]
#[should_panic(expected = "no open proposal")]
fn expired_proposals_cannot_pass() {
    let mut c = active();
    ctx(operator(), T0);
    let id = c.propose_change(new_code());
    ctx(alice(), T0 + 7 * DAY);
    c.approve_change(id);
}

#[test]
#[should_panic(expected = "a proposal is already open")]
fn only_one_proposal_at_a_time() {
    let mut c = active();
    ctx(operator(), T0);
    c.propose_change(new_code());
    c.propose_change(new_code());
}

#[test]
fn an_expired_proposal_can_be_replaced() {
    let mut c = active();
    ctx(operator(), T0);
    c.propose_change(new_code());
    ctx(operator(), T0 + 7 * DAY);
    let id = c.propose_change(new_code());
    assert_eq!(id, 1);
}

#[test]
#[should_panic(expected = "a vote cannot add vendors")]
fn a_vote_cannot_add_a_vendor() {
    let mut c = active();
    let mut s = new_code();
    s.policy.vendors.push(alice());
    ctx(operator(), T0);
    c.propose_change(s);
}

#[test]
#[should_panic(expected = "a vote cannot raise spending limits")]
fn a_vote_cannot_raise_limits() {
    let mut c = active();
    let mut s = new_code();
    s.policy.max_per_day = U128(1_000_000);
    ctx(operator(), T0);
    c.propose_change(s);
}

#[test]
fn a_vote_can_tighten_the_policy() {
    let mut c = active();
    let mut s = new_code();
    s.policy.vendors.clear();
    s.policy.max_per_tx = U128(0);
    s.policy.max_per_day = U128(0);
    ctx(operator(), T0);
    assert_eq!(c.propose_change(s), 0);
}

#[test]
#[should_panic(expected = "only the operator")]
fn strangers_cannot_propose_on_an_active_loan() {
    let mut c = active();
    ctx(alice(), T0);
    c.propose_change(new_code());
}

#[test]
fn in_foreclosure_lenders_propose_and_the_operator_has_no_say() {
    let mut c = foreclosed();
    ctx(alice(), T0 + 2 * DAY);
    let id = c.propose_change(new_code());
    c.approve_change(id);
    assert_eq!(c.service.wasm.hash, "b".repeat(64));
}

#[test]
#[should_panic(expected = "this account holds no note")]
fn a_foreclosed_operator_cannot_propose() {
    let mut c = foreclosed();
    ctx(operator(), T0 + 2 * DAY);
    c.propose_change(new_code());
}

#[test]
fn foreclosure_kills_a_pending_operator_proposal() {
    let mut c = active();
    ctx(operator(), T0);
    c.propose_change(new_code());
    ctx(alice(), T0 + DAY + HOUR);
    c.foreclose();
    assert!(c.proposal.is_none());
}

// ---------- views ----------

#[test]
fn the_view_reports_when_a_loan_becomes_foreclosable() {
    let c = active();
    let v = c.get_loan(0).unwrap();
    assert_eq!(v.breach_at, Some(T0 + DAY));
    assert_eq!(v.foreclosable_at, Some(T0 + DAY + HOUR));
    assert_eq!(v.maturity, Some(T0 + 30 * DAY));
    assert!(!v.is_behind);
    assert_eq!(v.outstanding.0, 110_000);
    assert!(v.min_next_bid.is_none());
}

#[test]
fn loans_list_newest_first() {
    let mut c = active();
    send(&mut c, alice(), 110_000, json!({"action":"repay"}), T0 + 1);
    offer(&mut c, terms());
    let ids: Vec<u32> = c.get_loans(None, None).iter().map(|l| l.loan.id).collect();
    assert_eq!(ids, vec![1, 0]);
}

#[test]
fn get_agent_serialises() {
    let mut c = active();
    start_job(&mut c, T0);
    ctx(alice(), T0);
    let view = near_sdk::serde_json::to_value(c.get_agent()).unwrap();
    assert_eq!(view["current_loan"]["status"], "Active");
    assert_eq!(view["current_loan"]["outstanding"], "110000");
    assert_eq!(view["pending_jobs"], 1);
}

// ---------- conservation across a whole life ----------

thread_local! {
    static PUSHED: std::cell::Cell<u128> = const { std::cell::Cell::new(0) };
}

pub(crate) fn record_push(amount: u128) {
    PUSHED.with(|p| p.set(p.get() + amount));
}

#[test]
fn the_ledger_always_matches_money_in_minus_money_out() {
    let mut c = active();
    PUSHED.with(|p| p.set(0));
    let mut money_in: u128 = 100_000;
    for step in 0..120u64 {
        let now = T0 + step * 900;
        match step % 5 {
            0 => {
                money_in += 1_000;
                let id = start_job(&mut c, now);
                ctx(acc("scout.lien.near"), now);
                let result = if step % 10 == 0 { Err(PromiseError::Failed) } else { job_ok(json!(1)) };
                c.on_job_result(id, result);
            }
            1 => {
                money_in += 2_345;
                revenue(&mut c, 2_345, now);
            }
            2 => {
                ctx(alice(), now);
                if c.get_note(0, alice()).unwrap().claimable.0 > 0 {
                    c.claim(0);
                }
            }
            3 => {
                money_in += 1_000;
                let id = start_job(&mut c, now);
                ctx(acc("scout.lien.near"), now);
                c.on_job_result(id, Ok(Some(json!({"ok":true,"spends":[{"to":"vendor.near","amount":"50"}]}))));
            }
            _ => {
                ctx(operator(), now);
                if c.ledger.operator.0 > 0 && !c.is_trapped() {
                    c.withdraw_operator(None);
                }
            }
        }
        let pushed = PUSHED.with(|p| p.get());
        assert_eq!(c.ledger.total() + pushed, money_in, "step {step}");
    }
    assert!(PUSHED.with(|p| p.get()) > 0, "the test should have paid something out");
}
