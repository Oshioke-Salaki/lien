//! The note market against a real business, token and registry on a sandbox
//! node: an atomic sale, and every way a buy can fail returning the money.

mod common;

use anyhow::Result;
use common::{failure_text, ok, Env, USD};
use near_workspaces::types::NearToken;
use near_workspaces::{Account, AccountId, Contract};
use serde_json::{json, Value};
use std::path::Path;

const PRICE: u128 = 50 * USD;

async fn deploy_market(env: &Env) -> Result<Contract> {
    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../target/near/lien_notemarket/lien_notemarket.wasm");
    let code = std::fs::read(&path).map_err(|e| anyhow::anyhow!("{}: {e}. Run scripts/build.sh first.", path.display()))?;
    let market = env
        .worker
        .root_account()?
        .create_subaccount("market")
        .initial_balance(NearToken::from_near(10))
        .transact()
        .await?
        .into_result()?
        .deploy(&code)
        .await?
        .into_result()?;
    ok(market.call("new").args_json(json!({ "token": env.token.id(), "registry": env.registry.id() })).transact().await?)?;
    ok(env
        .alice
        .call(env.token.id(), "storage_deposit")
        .args_json(json!({ "account_id": market.id() }))
        .deposit(NearToken::from_millinear(2))
        .transact()
        .await?)?;
    Ok(market)
}

async fn note(env: &Env, business: &AccountId, who: &AccountId) -> Result<Option<u128>> {
    let v: Value = env.worker.view(business, "get_note").args_json(json!({ "loan_id": 0, "account_id": who })).await?.json()?;
    Ok(v.get("principal").map(|p| p.as_str().unwrap().parse().unwrap()))
}

async fn listing(env: &Env, market: &Contract, business: &AccountId) -> Result<Value> {
    Ok(env.worker.view(market.id(), "get_listing").args_json(json!({ "business": business, "loan_id": 0 })).await?.json()?)
}

async fn buy(env: &Env, buyer: &Account, market: &Contract, business: &AccountId, amount: u128) -> Result<String> {
    let result = env.pay(buyer, market.id().as_str(), amount, json!({ "buy": { "business": business, "loan_id": 0 } })).await?;
    // The outer transfer succeeds even when the market refuses: the token then refunds.
    Ok(failure_text(&result))
}

async fn list_and_deliver(env: &Env, seller: &Account, market: &Contract, business: &AccountId) -> Result<()> {
    ok(seller
        .call(market.id(), "list")
        .args_json(json!({ "business": business, "loan_id": 0, "price": PRICE.to_string() }))
        .deposit(NearToken::from_millinear(10))
        .max_gas()
        .transact()
        .await?)?;
    ok(seller
        .call(business, "transfer_note")
        .args_json(json!({ "loan_id": 0, "to": market.id() }))
        .deposit(NearToken::from_yoctonear(1))
        .max_gas()
        .transact()
        .await?)?;
    ok(env.carol.call(market.id(), "confirm").args_json(json!({ "business": business, "loan_id": 0 })).max_gas().transact().await?)?;
    Ok(())
}

#[tokio::test]
async fn a_note_and_its_price_change_hands_atomically_and_every_failed_buy_is_refunded() -> Result<()> {
    let env = Env::new().await?;
    let agent = env.create_agent("scout").await?;
    let business: AccountId = agent.parse()?;
    env.fund_fully(&agent).await?; // alice holds 60, bob 40
    let market = deploy_market(&env).await?;

    // Alice reserves the listing; Bob cannot take the same loan's slot.
    ok(env
        .alice
        .call(market.id(), "list")
        .args_json(json!({ "business": business, "loan_id": 0, "price": PRICE.to_string() }))
        .deposit(NearToken::from_millinear(10))
        .max_gas()
        .transact()
        .await?)?;
    assert_eq!(listing(&env, &market, &business).await?["principal"], "60000000");
    let taken = env
        .bob
        .call(market.id(), "list")
        .args_json(json!({ "business": business, "loan_id": 0, "price": "1" }))
        .deposit(NearToken::from_millinear(10))
        .max_gas()
        .transact()
        .await?;
    assert!(failure_text(&taken).contains("already has a listing"));

    // Not delivered yet: nothing to buy, and confirm does not put it up.
    let carol_before = env.balance(env.carol.id()).await?;
    assert!(buy(&env, &env.carol, &market, &business, PRICE).await?.contains("not for sale yet"));
    ok(env.carol.call(market.id(), "confirm").args_json(json!({ "business": business, "loan_id": 0 })).max_gas().transact().await?)?;
    assert_eq!(listing(&env, &market, &business).await?["status"], "Pending");

    ok(env
        .alice
        .call(&business, "transfer_note")
        .args_json(json!({ "loan_id": 0, "to": market.id() }))
        .deposit(NearToken::from_yoctonear(1))
        .max_gas()
        .transact()
        .await?)?;
    ok(env.carol.call(market.id(), "confirm").args_json(json!({ "business": business, "loan_id": 0 })).max_gas().transact().await?)?;
    assert_eq!(listing(&env, &market, &business).await?["status"], "ForSale");

    // A wrong price bounces in full.
    assert!(buy(&env, &env.carol, &market, &business, PRICE - 1).await?.contains("the price is"));
    assert_eq!(env.balance(env.carol.id()).await?, carol_before);

    // A buy the business refuses: Bob voted on an open proposal, so his note is
    // locked and the business will not merge another note into it. The note
    // stays in the market, Bob gets his money back, Alice is not paid.
    let proposal: u32 = env
        .operator
        .call(&business, "propose_change")
        .args_json(json!({ "service": env.service() }))
        .max_gas()
        .transact()
        .await?
        .json()?;
    ok(env.bob.call(&business, "approve_change").args_json(json!({ "proposal_id": proposal })).max_gas().transact().await?)?;
    let bob_before = env.balance(env.bob.id()).await?;
    let alice_before = env.balance(env.alice.id()).await?;
    let refused = buy(&env, &env.bob, &market, &business, PRICE).await?;
    assert!(refused.contains("cannot move until it closes"), "{refused}");
    assert_eq!(env.balance(env.bob.id()).await?, bob_before);
    assert_eq!(env.balance(env.alice.id()).await?, alice_before);
    assert_eq!(env.balance(market.id()).await?, 0);
    assert_eq!(note(&env, &business, market.id()).await?, Some(60 * USD));
    let l = listing(&env, &market, &business).await?;
    assert_eq!((l["status"].as_str(), l["busy"].as_bool()), (Some("ForSale"), Some(false)));

    // The sale: one transaction moves the note to Carol and the price to Alice.
    assert_eq!(buy(&env, &env.carol, &market, &business, PRICE).await?, "[]");
    assert_eq!(note(&env, &business, env.carol.id()).await?, Some(60 * USD));
    assert_eq!(note(&env, &business, market.id()).await?, None);
    assert_eq!(env.balance(env.carol.id()).await?, carol_before - PRICE);
    assert_eq!(env.balance(env.alice.id()).await?, alice_before + PRICE);
    assert_eq!(env.balance(market.id()).await?, 0);
    assert!(listing(&env, &market, &business).await?.is_null());

    // A second buy of the same note finds nothing and is refunded.
    assert!(buy(&env, &env.alice, &market, &business, PRICE).await?.contains("not listed"));
    assert_eq!(env.balance(env.alice.id()).await?, alice_before + PRICE);

    // Nobody can call the callbacks to fake a sale or a payout.
    let forged = env
        .carol
        .call(market.id(), "on_bought")
        .args_json(json!({ "business": business, "loan_id": 0, "buyer": env.carol.id(), "amount": "1" }))
        .max_gas()
        .transact()
        .await?;
    assert!(failure_text(&forged).contains("private"));
    let forged = env.carol.call(market.id(), "on_paid").args_json(json!({ "account_id": env.carol.id(), "amount": "1" })).max_gas().transact().await?;
    assert!(failure_text(&forged).contains("private"));

    // Cancel: Carol lists the note she bought, then takes it back.
    list_and_deliver(&env, &env.carol, &market, &business).await?;
    assert_eq!(note(&env, &business, env.carol.id()).await?, None);
    let stranger = env.bob.call(market.id(), "cancel").args_json(json!({ "business": business, "loan_id": 0 })).deposit(NearToken::from_yoctonear(1)).max_gas().transact().await?;
    assert!(failure_text(&stranger).contains("only the seller"));
    ok(env.carol.call(market.id(), "cancel").args_json(json!({ "business": business, "loan_id": 0 })).deposit(NearToken::from_yoctonear(1)).max_gas().transact().await?)?;
    assert_eq!(note(&env, &business, env.carol.id()).await?, Some(60 * USD));
    assert_eq!(note(&env, &business, market.id()).await?, None);
    assert!(listing(&env, &market, &business).await?.is_null());
    Ok(())
}
