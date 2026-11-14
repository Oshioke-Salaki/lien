use super::*;
use near_sdk::mock::MockAction;
use near_sdk::test_utils::{get_created_receipts, get_logs, VMContextBuilder};
use near_sdk::{testing_env, PromiseResult};

const MARKET: &str = "market.lien.testnet";
const TOKEN: &str = "usd.lien.testnet";
const REGISTRY: &str = "v1.lien.testnet";
const BUSINESS: &str = "watchtower.v1.lien.testnet";
const SELLER: &str = "seller.testnet";
const BUYER: &str = "buyer.testnet";
const PRICE: u128 = 30_000_000;
const PRINCIPAL: u128 = 40_000_000;

fn acc(s: &str) -> AccountId {
    s.parse().unwrap()
}

fn ctx(predecessor: &str, deposit: NearToken, time: u64, results: Vec<PromiseResult>) {
    testing_env!(
        VMContextBuilder::new()
            .current_account_id(acc(MARKET))
            .predecessor_account_id(acc(predecessor))
            .attached_deposit(deposit)
            .block_timestamp(time)
            .prepaid_gas(Gas::from_tgas(300))
            .build(),
        near_sdk::test_vm_config(),
        near_sdk::RuntimeFeesConfig::test(),
        Default::default(),
        results
    );
}

fn call(predecessor: &str, deposit: NearToken) {
    ctx(predecessor, deposit, 1_000, vec![]);
}

/// The market calling itself back with these promise results.
fn callback(results: Vec<PromiseResult>) {
    ctx(MARKET, NearToken::from_yoctonear(0), 1_000, results);
}

fn note(principal: u128) -> PromiseResult {
    PromiseResult::Successful(format!(r#"{{"principal":"{principal}","claimed":"0","voted_proposal":null,"claimable":"5230000"}}"#).into_bytes())
}
fn no_note() -> PromiseResult {
    PromiseResult::Successful(b"null".to_vec())
}
fn ok() -> PromiseResult {
    PromiseResult::Successful(vec![])
}

fn market() -> NoteMarket {
    call(MARKET, NearToken::from_yoctonear(0));
    NoteMarket::new(acc(TOKEN), acc(REGISTRY))
}

fn listing(m: &NoteMarket) -> Listing {
    m.get_listing(acc(BUSINESS), 0).expect("listed")
}

/// Reserved and checked, not yet confirmed.
fn pending() -> NoteMarket {
    let mut m = market();
    call(SELLER, LISTING_BOND);
    let _ = m.list(acc(BUSINESS), 0, U128(PRICE));
    callback(vec![note(PRINCIPAL), no_note()]);
    assert!(m.on_list_checked(acc(BUSINESS), 0));
    m
}

fn for_sale() -> NoteMarket {
    let mut m = pending();
    call("anyone.testnet", NearToken::from_yoctonear(0));
    let _ = m.confirm(acc(BUSINESS), 0);
    callback(vec![note(PRINCIPAL), no_note()]);
    assert!(m.on_confirmed(acc(BUSINESS), 0));
    m
}

fn buy(m: &mut NoteMarket, buyer: &str, amount: u128) -> PromiseOrValue<U128> {
    call(TOKEN, NearToken::from_yoctonear(0));
    m.ft_on_transfer(acc(buyer), U128(amount), json_buy(BUSINESS, 0))
}

fn json_buy(business: &str, loan_id: u32) -> String {
    format!(r#"{{"buy":{{"business":"{business}","loan_id":{loan_id}}}}}"#)
}

/// (receiver, method, args, deposit) of every function call the last call created.
fn calls() -> Vec<(String, String, String, u128)> {
    get_created_receipts()
        .into_iter()
        .flat_map(|r| {
            let receiver = r.receiver_id.to_string();
            r.actions.into_iter().filter_map(move |a| match a {
                MockAction::FunctionCallWeight { method_name, args, attached_deposit, .. } => Some((
                    receiver.clone(),
                    String::from_utf8(method_name).unwrap(),
                    String::from_utf8(args).unwrap(),
                    attached_deposit.as_yoctonear(),
                )),
                _ => None,
            })
        })
        .collect()
}

fn transfers() -> Vec<(String, u128)> {
    get_created_receipts()
        .into_iter()
        .flat_map(|r| {
            let receiver = r.receiver_id.to_string();
            r.actions.into_iter().filter_map(move |a| match a {
                MockAction::Transfer { deposit, .. } => Some((receiver.clone(), deposit.as_yoctonear())),
                _ => None,
            })
        })
        .collect()
}

// ---------- list ----------

#[test]
fn list_reserves_then_checks_both_notes_with_the_business() {
    let mut m = market();
    call(SELLER, LISTING_BOND);
    let _ = m.list(acc(BUSINESS), 0, U128(PRICE));
    let l = listing(&m);
    assert_eq!((l.status, l.busy, l.seller.as_str()), (Status::Pending, true, SELLER));
    let c = calls();
    assert_eq!(c[0].0, BUSINESS);
    assert_eq!(c[0].1, "get_note");
    assert!(c[0].2.contains(SELLER));
    assert!(c[1].2.contains(MARKET));

    callback(vec![note(PRINCIPAL), no_note()]);
    assert!(m.on_list_checked(acc(BUSINESS), 0));
    let l = listing(&m);
    assert_eq!((l.status, l.busy, l.principal.0), (Status::Pending, false, PRINCIPAL));
}

#[test]
fn a_seller_without_a_note_is_not_listed_and_gets_the_bond_back() {
    let mut m = market();
    call(SELLER, LISTING_BOND);
    let _ = m.list(acc(BUSINESS), 0, U128(PRICE));
    callback(vec![no_note(), no_note()]);
    assert!(!m.on_list_checked(acc(BUSINESS), 0));
    assert!(m.get_listing(acc(BUSINESS), 0).is_none());
    assert_eq!(transfers(), vec![(SELLER.to_string(), LISTING_BOND.as_yoctonear())]);
    assert!(get_logs().iter().any(|l| l.contains("the seller holds no note")));
}

#[test]
fn a_loan_whose_note_already_sits_in_the_market_cannot_be_listed() {
    let mut m = market();
    call(SELLER, LISTING_BOND);
    let _ = m.list(acc(BUSINESS), 0, U128(PRICE));
    callback(vec![note(PRINCIPAL), note(1)]);
    assert!(!m.on_list_checked(acc(BUSINESS), 0));
    assert!(m.get_listing(acc(BUSINESS), 0).is_none());
}

#[test]
fn a_business_that_does_not_answer_is_not_listed() {
    let mut m = market();
    call(SELLER, LISTING_BOND);
    let _ = m.list(acc(BUSINESS), 0, U128(PRICE));
    callback(vec![PromiseResult::Failed, no_note()]);
    assert!(!m.on_list_checked(acc(BUSINESS), 0));
    assert!(m.get_listing(acc(BUSINESS), 0).is_none());
}

#[test]
#[should_panic(expected = "this loan already has a listing")]
fn nobody_else_can_list_a_reserved_loan() {
    let mut m = pending();
    call("thief.testnet", LISTING_BOND);
    let _ = m.list(acc(BUSINESS), 0, U128(1));
}

#[test]
#[should_panic(expected = "not a Lien business")]
fn only_businesses_under_the_registry_can_be_listed() {
    let mut m = market();
    call(SELLER, LISTING_BOND);
    let _ = m.list(acc("fake.evil.testnet"), 0, U128(PRICE));
}

#[test]
#[should_panic(expected = "not a Lien business")]
fn a_deeper_sub_account_is_not_a_business() {
    let mut m = market();
    call(SELLER, LISTING_BOND);
    let _ = m.list(acc("x.watchtower.v1.lien.testnet"), 0, U128(PRICE));
}

#[test]
#[should_panic(expected = "listing bond")]
fn a_listing_needs_the_bond() {
    let mut m = market();
    call(SELLER, NearToken::from_yoctonear(1));
    let _ = m.list(acc(BUSINESS), 0, U128(PRICE));
}

#[test]
#[should_panic(expected = "the price must be positive")]
fn a_free_listing_is_refused() {
    let mut m = market();
    call(SELLER, LISTING_BOND);
    let _ = m.list(acc(BUSINESS), 0, U128(0));
}

// ---------- confirm ----------

#[test]
fn confirm_needs_the_whole_note_in_the_market() {
    let mut m = pending();
    call("anyone.testnet", NearToken::from_yoctonear(0));
    let _ = m.confirm(acc(BUSINESS), 0);
    assert!(listing(&m).busy);
    // Not delivered yet.
    callback(vec![no_note(), note(PRINCIPAL)]);
    assert!(!m.on_confirmed(acc(BUSINESS), 0));
    assert_eq!((listing(&m).status, listing(&m).busy), (Status::Pending, false));
    // A different principal is not the listed note.
    call("anyone.testnet", NearToken::from_yoctonear(0));
    let _ = m.confirm(acc(BUSINESS), 0);
    callback(vec![note(PRINCIPAL + 1), no_note()]);
    assert!(!m.on_confirmed(acc(BUSINESS), 0));
    // The seller still holding a note means this one came from someone else.
    call("anyone.testnet", NearToken::from_yoctonear(0));
    let _ = m.confirm(acc(BUSINESS), 0);
    callback(vec![note(PRINCIPAL), note(PRINCIPAL)]);
    assert!(!m.on_confirmed(acc(BUSINESS), 0));
    // Delivered.
    call("anyone.testnet", NearToken::from_yoctonear(0));
    let _ = m.confirm(acc(BUSINESS), 0);
    callback(vec![note(PRINCIPAL), no_note()]);
    assert!(m.on_confirmed(acc(BUSINESS), 0));
    assert_eq!(listing(&m).status, Status::ForSale);
}

// ---------- buy ----------

#[test]
fn a_buy_moves_the_note_to_the_buyer_then_pays_the_seller() {
    let mut m = for_sale();
    let _ = buy(&mut m, BUYER, PRICE);
    assert!(listing(&m).busy);
    let c = calls();
    assert_eq!((c[0].0.as_str(), c[0].1.as_str(), c[0].3), (BUSINESS, "transfer_note", 1));
    assert_eq!(c[0].2, format!(r#"{{"loan_id":0,"to":"{BUYER}"}}"#));
    assert_eq!(c[1].1, "on_bought");

    callback(vec![ok()]);
    assert_eq!(m.on_bought(acc(BUSINESS), 0, acc(BUYER), U128(PRICE)).0, 0);
    assert!(m.get_listing(acc(BUSINESS), 0).is_none());
    let c = calls();
    assert_eq!((c[0].0.as_str(), c[0].1.as_str(), c[0].3), (TOKEN, "ft_transfer", 1));
    assert!(c[0].2.contains(&format!(r#""receiver_id":"{SELLER}","amount":"{PRICE}""#)));
    assert_eq!(c[1].1, "on_paid");
    assert_eq!(transfers(), vec![(SELLER.to_string(), LISTING_BOND.as_yoctonear())]);
    assert!(get_logs().iter().any(|l| l.contains(r#""event":"sold""#) && l.contains(BUYER)));
}

#[test]
fn a_failed_note_transfer_refunds_the_buyer_and_pays_nobody() {
    let mut m = for_sale();
    let _ = buy(&mut m, BUYER, PRICE);
    callback(vec![PromiseResult::Failed]);
    assert_eq!(m.on_bought(acc(BUSINESS), 0, acc(BUYER), U128(PRICE)).0, PRICE);
    assert!(calls().is_empty(), "no payout");
    assert!(transfers().is_empty());
    let l = listing(&m);
    assert_eq!((l.status, l.busy), (Status::ForSale, false), "still for sale");
}

#[test]
#[should_panic(expected = "the price is 30000000")]
fn a_wrong_price_bounces() {
    let mut m = for_sale();
    let _ = buy(&mut m, BUYER, PRICE - 1);
}

#[test]
#[should_panic(expected = "the price is 30000000")]
fn overpaying_bounces_too() {
    let mut m = for_sale();
    let _ = buy(&mut m, BUYER, PRICE + 1);
}

#[test]
#[should_panic(expected = "only usd.lien.testnet is accepted")]
fn a_wrong_token_bounces() {
    let mut m = for_sale();
    call("fake-usd.testnet", NearToken::from_yoctonear(0));
    let _ = m.ft_on_transfer(acc(BUYER), U128(PRICE), json_buy(BUSINESS, 0));
}

#[test]
#[should_panic(expected = "that note is not listed")]
fn an_unlisted_note_bounces() {
    let mut m = for_sale();
    call(TOKEN, NearToken::from_yoctonear(0));
    let _ = m.ft_on_transfer(acc(BUYER), U128(PRICE), json_buy(BUSINESS, 1));
}

#[test]
#[should_panic(expected = "not for sale yet")]
fn an_unconfirmed_note_bounces() {
    let mut m = pending();
    let _ = buy(&mut m, BUYER, PRICE);
}

#[test]
#[should_panic(expected = "msg must be")]
fn an_unknown_message_bounces() {
    let mut m = for_sale();
    call(TOKEN, NearToken::from_yoctonear(0));
    let _ = m.ft_on_transfer(acc(BUYER), U128(PRICE), r#"{"action":"fund"}"#.into());
}

#[test]
#[should_panic(expected = "your own listing")]
fn the_seller_cannot_buy_their_own_note() {
    let mut m = for_sale();
    let _ = buy(&mut m, SELLER, PRICE);
}

#[test]
#[should_panic(expected = "in progress")]
fn a_second_buy_while_the_first_is_in_flight_bounces() {
    let mut m = for_sale();
    let _ = buy(&mut m, BUYER, PRICE);
    let _ = buy(&mut m, "second.testnet", PRICE);
}

#[test]
#[should_panic(expected = "that note is not listed")]
fn a_second_buy_after_the_sale_bounces() {
    let mut m = for_sale();
    let _ = buy(&mut m, BUYER, PRICE);
    callback(vec![ok()]);
    m.on_bought(acc(BUSINESS), 0, acc(BUYER), U128(PRICE));
    let _ = buy(&mut m, "second.testnet", PRICE);
}

#[test]
fn a_refused_payout_becomes_a_credit_anyone_can_retry() {
    let mut m = market();
    callback(vec![PromiseResult::Failed]);
    m.on_paid(acc(SELLER), U128(PRICE));
    assert_eq!(m.get_credit(acc(SELLER)).0, PRICE);
    call("anyone.testnet", NearToken::from_yoctonear(0));
    m.withdraw(acc(SELLER));
    assert_eq!(m.get_credit(acc(SELLER)).0, 0);
    let c = calls();
    assert_eq!((c[0].0.as_str(), c[0].1.as_str()), (TOKEN, "ft_transfer"));
    assert!(c[0].2.contains(SELLER));
    // A successful payout leaves no credit.
    callback(vec![ok()]);
    m.on_paid(acc(SELLER), U128(PRICE));
    assert_eq!(m.get_credit(acc(SELLER)).0, 0);
}

// ---------- cancel ----------

#[test]
fn cancel_returns_the_note_and_the_bond() {
    let mut m = for_sale();
    call(SELLER, NearToken::from_yoctonear(1));
    let _ = m.cancel(acc(BUSINESS), 0);
    assert!(listing(&m).busy);
    callback(vec![note(PRINCIPAL)]);
    let _ = m.on_cancel_checked(acc(BUSINESS), 0);
    let c = calls();
    assert_eq!((c[0].1.as_str(), c[0].3), ("transfer_note", 1));
    assert_eq!(c[0].2, format!(r#"{{"loan_id":0,"to":"{SELLER}"}}"#));
    callback(vec![ok()]);
    assert!(m.on_cancelled(acc(BUSINESS), 0));
    assert!(m.get_listing(acc(BUSINESS), 0).is_none());
    assert_eq!(transfers(), vec![(SELLER.to_string(), LISTING_BOND.as_yoctonear())]);
}

#[test]
fn a_cancel_the_business_refuses_keeps_the_listing() {
    let mut m = for_sale();
    call(SELLER, NearToken::from_yoctonear(1));
    let _ = m.cancel(acc(BUSINESS), 0);
    callback(vec![note(PRINCIPAL)]);
    let _ = m.on_cancel_checked(acc(BUSINESS), 0);
    callback(vec![PromiseResult::Failed]);
    assert!(!m.on_cancelled(acc(BUSINESS), 0));
    assert_eq!((listing(&m).status, listing(&m).busy), (Status::ForSale, false));
}

#[test]
fn cancelling_before_delivery_just_returns_the_bond() {
    let mut m = pending();
    call(SELLER, NearToken::from_yoctonear(1));
    let _ = m.cancel(acc(BUSINESS), 0);
    callback(vec![no_note()]);
    let _ = m.on_cancel_checked(acc(BUSINESS), 0);
    assert!(calls().is_empty());
    assert_eq!(transfers(), vec![(SELLER.to_string(), LISTING_BOND.as_yoctonear())]);
    assert!(m.get_listing(acc(BUSINESS), 0).is_none());
}

#[test]
#[should_panic(expected = "only the seller can cancel")]
fn a_stranger_cannot_cancel_a_listing_for_sale() {
    let mut m = for_sale();
    ctx("thief.testnet", NearToken::from_yoctonear(1), 1_000 + 10 * PENDING_TTL_NS, vec![]);
    let _ = m.cancel(acc(BUSINESS), 0);
}

#[test]
fn anyone_can_clear_a_stale_unconfirmed_listing_and_the_seller_gets_everything() {
    let mut m = pending();
    ctx("anyone.testnet", NearToken::from_yoctonear(1), 1_000 + PENDING_TTL_NS, vec![]);
    let _ = m.cancel(acc(BUSINESS), 0);
    callback(vec![note(PRINCIPAL)]);
    let _ = m.on_cancel_checked(acc(BUSINESS), 0);
    // The note goes to the seller, not to whoever cleared the listing.
    assert_eq!(calls()[0].2, format!(r#"{{"loan_id":0,"to":"{SELLER}"}}"#));
}

#[test]
#[should_panic(expected = "only the seller can cancel")]
fn a_fresh_unconfirmed_listing_is_the_sellers_alone() {
    let mut m = pending();
    ctx("anyone.testnet", NearToken::from_yoctonear(1), 1_000 + PENDING_TTL_NS - 1_001, vec![]);
    let _ = m.cancel(acc(BUSINESS), 0);
}

#[test]
#[should_panic(expected = "busy")]
fn cancel_cannot_race_a_sale() {
    let mut m = for_sale();
    let _ = buy(&mut m, BUYER, PRICE);
    call(SELLER, NearToken::from_yoctonear(1));
    let _ = m.cancel(acc(BUSINESS), 0);
}

#[test]
#[should_panic(expected = "1 yoctoNEAR")]
fn cancel_needs_a_full_access_key() {
    let mut m = for_sale();
    call(SELLER, NearToken::from_yoctonear(0));
    let _ = m.cancel(acc(BUSINESS), 0);
}

#[test]
fn listings_are_listed() {
    let m = for_sale();
    let all = m.get_listings(None, None);
    assert_eq!(all.len(), 1);
    assert_eq!(all[0].price.0, PRICE);
    assert_eq!(m.get_config().token.as_str(), TOKEN);
}
