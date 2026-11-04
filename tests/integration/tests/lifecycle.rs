//! Whole-life scenarios with real cross-contract calls on a sandbox node.

mod common;

use anyhow::Result;
use common::{failure_text, ok, Env, USD};
use near_workspaces::types::NearToken;
use serde_json::{json, Value};

fn s(v: &Value) -> u128 {
    v.as_str().unwrap().parse().unwrap()
}

fn job_output(spends: Value) -> Value {
    json!({ "ok": true, "report": { "risk": "low", "score": 12 }, "spends": spends })
}

#[tokio::test]
async fn a_created_business_has_no_keys_and_is_listed() -> Result<()> {
    let env = Env::new().await?;
    let agent = env.create_agent("scout").await?;

    let agents: Vec<String> = env.worker.view(env.registry.id(), "get_agents").args_json(json!({})).await?.json()?;
    assert_eq!(agents, vec![agent.clone()]);

    let keys = env.worker.view_access_keys(&agent.parse()?).await?;
    assert!(keys.is_empty(), "the business must hold no access keys");
    let in_keys = env.worker.view_access_keys(&format!("scout-in.{}", env.registry.id()).parse()?).await?;
    assert!(in_keys.is_empty(), "the collector must hold no access keys");

    let view = env.view(&agent).await?;
    assert_eq!(view["operator"], env.operator.id().to_string());
    assert_eq!(view["registry"], env.registry.id().to_string());
    assert!(s(&view["tank"]) > NearToken::from_near(4).as_yoctonear());
    Ok(())
}

#[tokio::test]
async fn a_taken_label_refunds_the_deposit_and_lists_nothing_new() -> Result<()> {
    let env = Env::new().await?;
    env.create_agent("scout").await?;
    // Let the first call's gas refund land before measuring.
    env.wait_secs(3).await?;
    let before = env.operator.view_account().await?.balance.as_yoctonear();
    let registry_before = env.registry.view_account().await?.balance.as_yoctonear();
    let _ = env
        .operator
        .call(env.registry.id(), "create_agent")
        .args_json(json!({
            "label": "scout", "name": "Copy", "description": "", "source_url": "", "service": env.service(),
        }))
        .deposit(NearToken::from_near(5))
        .max_gas()
        .transact()
        .await?;
    env.wait_secs(3).await?;
    let after = env.operator.view_account().await?.balance.as_yoctonear();
    let registry_after = env.registry.view_account().await?.balance.as_yoctonear();

    let lost = before as i128 - after as i128;
    let limit = NearToken::from_millinear(200).as_yoctonear() as i128;
    assert!(lost >= 0, "the operator must not profit from a failed call: gained {}", -lost);
    assert!(lost < limit, "only gas and token registration should be lost, lost {lost}");
    // The registry must not be drained by paying a refund twice.
    assert!(registry_after + NearToken::from_millinear(10).as_yoctonear() >= registry_before, "registry fell from {registry_before} to {registry_after}");

    let agents: Vec<String> = env.worker.view(env.registry.id(), "get_agents").args_json(json!({})).await?.json()?;
    assert_eq!(agents.len(), 1);
    Ok(())
}

#[tokio::test]
async fn an_invalid_service_creates_nothing_and_refunds() -> Result<()> {
    let env = Env::new().await?;
    let mut bad = env.service();
    bad["price"] = json!("0");
    let before = env.operator.view_account().await?.balance;
    let _ = env
        .operator
        .call(env.registry.id(), "create_agent")
        .args_json(json!({ "label": "bad", "name": "Bad", "description": "", "source_url": "", "service": bad }))
        .deposit(NearToken::from_near(5))
        .max_gas()
        .transact()
        .await?;
    let agents: Vec<String> = env.worker.view(env.registry.id(), "get_agents").args_json(json!({})).await?.json()?;
    assert!(agents.is_empty());
    assert!(env.worker.view_account(&format!("bad.{}", env.registry.id()).parse()?).await.is_err());
    let lost = before.as_yoctonear() - env.operator.view_account().await?.balance.as_yoctonear();
    // The collector half did land, so its small balance is the only real cost.
    assert!(lost < NearToken::from_millinear(300).as_yoctonear(), "lost {lost}");
    Ok(())
}

#[tokio::test]
async fn a_job_runs_pays_lenders_and_stores_the_report() -> Result<()> {
    let env = Env::new().await?;
    let agent = env.create_agent("scout").await?;
    env.fund_fully(&agent).await?;

    env.set_output(Some(job_output(json!([{"to": env.vendor.id(), "amount": "100000"}]))), false).await?;
    let vendor_before = env.balance(env.vendor.id()).await?;
    ok(env.pay(&env.carol, &agent, USD, json!({"action":"job","input":"bob.near"})).await?)?;

    let job: Value = env.worker.view(&agent.parse()?, "get_job").args_json(json!({"job_id":0})).await?.json()?;
    assert_eq!(job["status"], "Done");
    assert_eq!(job["report"], r#"{"risk":"low","score":12}"#);

    let (input, source, secrets, format): (Option<String>, Option<String>, Option<String>, Option<String>) =
        env.worker.view(env.outlayer.id(), "get_last").await?.json()?;
    assert!(input.unwrap().contains("bob.near"));
    assert!(source.unwrap().contains(&"a".repeat(64)), "the pinned hash must be sent");
    assert!(secrets.is_none());
    assert_eq!(format.as_deref(), Some("Json"));

    let view = env.view(&agent).await?;
    assert_eq!(s(&view["current_loan"]["repaid"]), 300_000);
    assert_eq!(s(&view["ledger"]["operator"]), 200_000);
    assert_eq!(s(&view["stats"]["spent"]), 100_000);
    assert_eq!(env.balance(env.vendor.id()).await?, vendor_before + 100_000);
    env.assert_solvent(&agent).await?;

    ok(env.alice.call(&agent.parse()?, "claim").args_json(json!({"loan_id":0})).max_gas().transact().await?)?;
    assert_eq!(env.balance(env.alice.id()).await?, 1_000 * USD - 60 * USD + 180_000);
    env.assert_solvent(&agent).await?;
    Ok(())
}

#[tokio::test]
async fn failed_runs_return_the_customers_money() -> Result<()> {
    let env = Env::new().await?;
    let agent = env.create_agent("scout").await?;
    let before = env.balance(env.carol.id()).await?;

    // A run that returns null.
    env.set_output(None, false).await?;
    ok(env.pay(&env.carol, &agent, USD, json!({"action":"job","input":"a"})).await?)?;
    assert_eq!(env.balance(env.carol.id()).await?, before);

    // A request OutLayer refuses outright.
    env.set_output(None, true).await?;
    ok(env.pay(&env.carol, &agent, USD, json!({"action":"job","input":"b"})).await?)?;
    assert_eq!(env.balance(env.carol.id()).await?, before);

    // Output that is not the expected shape.
    env.set_output(Some(json!(["nonsense"])), false).await?;
    ok(env.pay(&env.carol, &agent, USD, json!({"action":"job","input":"c"})).await?)?;
    assert_eq!(env.balance(env.carol.id()).await?, before);

    let view = env.view(&agent).await?;
    assert_eq!(view["stats"]["jobs_refunded"], 3);
    assert_eq!(view["pending_jobs"], 0);
    assert_eq!(s(&view["ledger"]["job_escrow"]), 0);
    env.assert_solvent(&agent).await?;
    Ok(())
}

#[tokio::test]
async fn an_invalid_payment_bounces_back_in_full() -> Result<()> {
    let env = Env::new().await?;
    let agent = env.create_agent("scout").await?;
    let before = env.balance(env.carol.id()).await?;
    let under = env.pay(&env.carol, &agent, USD - 1, json!({"action":"job","input":"a"})).await?;
    assert!(format!("{:?}", under.receipt_failures()).contains("below the price"));
    let junk = env.pay(&env.carol, &agent, USD, json!({"action":"steal"})).await?;
    assert!(format!("{:?}", junk.receipt_failures()).contains("unrecognised"));
    assert_eq!(env.balance(env.carol.id()).await?, before);
    assert_eq!(env.balance(&agent).await?, 0);
    Ok(())
}

#[tokio::test]
async fn overpayment_change_comes_back() -> Result<()> {
    let env = Env::new().await?;
    let agent = env.create_agent("scout").await?;
    env.set_output(Some(job_output(json!([]))), false).await?;
    let before = env.balance(env.carol.id()).await?;
    ok(env.pay(&env.carol, &agent, 3 * USD, json!({"action":"job","input":"a"})).await?)?;
    assert_eq!(env.balance(env.carol.id()).await?, before - USD);
    env.assert_solvent(&agent).await?;
    Ok(())
}

#[tokio::test]
async fn money_sent_to_the_collector_runs_through_the_waterfall() -> Result<()> {
    let env = Env::new().await?;
    let agent = env.create_agent("scout").await?;
    env.fund_fully(&agent).await?;
    let collector = format!("scout-in.{}", env.registry.id());

    // A plain transfer, which is what a NEAR Intents payout looks like.
    ok(env.carol.call(env.token.id(), "ft_transfer")
        .args_json(json!({"receiver_id": collector, "amount": (10 * USD).to_string()}))
        .deposit(NearToken::from_yoctonear(1))
        .transact().await?)?;
    assert_eq!(env.balance(&collector).await?, 10 * USD);

    ok(env.alice.call(&collector.parse()?, "forward").max_gas().transact().await?)?;
    assert_eq!(env.balance(&collector).await?, 0);

    let view = env.view(&agent).await?;
    assert_eq!(s(&view["current_loan"]["repaid"]), 3 * USD);
    assert_eq!(s(&view["ledger"]["operator"]), 2 * USD);
    assert_eq!(s(&view["stats"]["external_revenue"]), 10 * USD);
    env.assert_solvent(&agent).await?;

    // Forwarding an empty inbox is harmless.
    ok(env.alice.call(&collector.parse()?, "forward").max_gas().transact().await?)?;
    assert_eq!(s(&env.view(&agent).await?["stats"]["external_revenue"]), 10 * USD);
    Ok(())
}

#[tokio::test]
async fn an_unregistered_recipient_cannot_block_anything_and_keeps_a_credit() -> Result<()> {
    let env = Env::new().await?;
    let agent = env.create_agent("scout").await?;
    env.fund_fully(&agent).await?;
    env.set_output(Some(job_output(json!([]))), false).await?;
    ok(env.pay(&env.carol, &agent, USD, json!({"action":"job","input":"x"})).await?)?;

    let root = env.worker.root_account()?;
    let stranger = root.create_subaccount("stranger").initial_balance(NearToken::from_near(5)).transact().await?.into_result()?;
    ok(env.bob.call(&agent.parse()?, "transfer_note")
        .args_json(json!({"loan_id":0,"to":stranger.id()}))
        .deposit(NearToken::from_yoctonear(1)).transact().await?)?;

    // The stranger has no token account, so the push fails and the credit returns.
    ok(stranger.call(&agent.parse()?, "claim").args_json(json!({"loan_id":0})).max_gas().transact().await?)?;
    let credit: Value = env.worker.view(&agent.parse()?, "get_credit").args_json(json!({"account_id":stranger.id()})).await?.json()?;
    assert_eq!(s(&credit), 120_000);
    env.assert_solvent(&agent).await?;

    // Once registered, anyone can complete the payout.
    env.register(&stranger).await?;
    ok(env.alice.call(&agent.parse()?, "withdraw").args_json(json!({"account_id":stranger.id()})).max_gas().transact().await?)?;
    assert_eq!(env.balance(stranger.id()).await?, 120_000);
    env.assert_solvent(&agent).await?;
    Ok(())
}

#[tokio::test]
async fn the_operator_cannot_reach_the_money_during_a_loan() -> Result<()> {
    let env = Env::new().await?;
    let agent = env.create_agent("scout").await?;
    env.fund_fully(&agent).await?;
    let id = agent.parse()?;

    let attempts: Vec<(&str, Value, &str)> = vec![
        ("withdraw_opex", json!({"amount": "1"}), "while a loan is open"),
        ("update_service", json!({"service": env.service()}), "while a loan is open"),
        ("withdraw_tank", json!({"amount": "1"}), "while a loan is open"),
        ("create_offer", json!({"terms": env.terms()}), "while a loan is open"),
    ];
    for (method, args, expected) in attempts {
        let result = env.operator.call(&id, method).args_json(args).max_gas().transact().await?;
        assert!(result.is_failure(), "{method} should fail");
        assert!(failure_text(&result).contains(expected), "{method}: {}", failure_text(&result));
    }
    let keys = env.worker.view_access_keys(&id).await?;
    assert!(keys.is_empty());
    assert_eq!(env.balance(&agent).await?, 100 * USD);
    Ok(())
}

#[tokio::test]
async fn compromised_code_cannot_pay_anyone_outside_the_policy() -> Result<()> {
    let env = Env::new().await?;
    let agent = env.create_agent("scout").await?;
    env.fund_fully(&agent).await?;
    env.set_output(
        Some(job_output(json!([
            {"to": env.operator.id(), "amount": "1"},
            {"to": env.carol.id(), "amount": (50 * USD).to_string()},
            {"to": env.vendor.id(), "amount": (50 * USD).to_string()},
        ]))),
        false,
    ).await?;
    let (op, carol) = (env.balance(env.operator.id()).await?, env.balance(env.carol.id()).await?);
    ok(env.pay(&env.carol, &agent, USD, json!({"action":"job","input":"x"})).await?)?;
    let view = env.view(&agent).await?;
    assert_eq!(view["stats"]["spends_blocked"], 3);
    assert_eq!(s(&view["stats"]["spent"]), 0);
    assert_eq!(env.balance(env.operator.id()).await?, op);
    assert_eq!(env.balance(env.carol.id()).await?, carol - USD);
    env.assert_solvent(&agent).await?;
    Ok(())
}

#[tokio::test]
async fn a_stranger_can_foreclose_and_the_business_keeps_serving_for_lenders() -> Result<()> {
    let env = Env::new().await?;
    let agent = env.create_agent("scout").await?;
    env.fund_with(&agent, env.fast_terms()).await?;
    let id: near_workspaces::AccountId = agent.parse()?;

    let early = env.carol.call(&id, "foreclose").max_gas().transact().await?;
    let breach: u64 = env.view(&agent).await?["current_loan"]["foreclosable_at"].as_u64().unwrap();
    assert!(early.is_failure() || env.view(&agent).await?["now"].as_u64().unwrap() >= breach);

    // Wait out the first window and grace.
    env.wait_secs(5).await?;
    ok(env.carol.call(&id, "foreclose").max_gas().transact().await?)?;
    let view = env.view(&agent).await?;
    let loan = &view["current_loan"];
    assert_eq!(loan["status"], "Foreclosed");
    // Idle capital above the 7 day runway (35 USD) went straight to lenders.
    assert_eq!(s(&view["ledger"]["opex"]), 35 * USD);
    assert_eq!(s(&loan["repaid"]), 65 * USD);
    assert_eq!(s(&loan["outstanding"]), 45 * USD);
    env.assert_solvent(&agent).await?;

    // The business keeps serving customers, now for lenders.
    env.set_output(Some(job_output(json!([]))), false).await?;
    ok(env.pay(&env.bob, &agent, USD, json!({"action":"job","input":"still alive?"})).await?)?;
    let view = env.view(&agent).await?;
    assert_eq!(view["stats"]["jobs_done"], 1);
    assert_eq!(s(&view["current_loan"]["repaid"]), 65 * USD + 500_000);
    assert_eq!(s(&view["ledger"]["operator"]), 0);

    // The old operator is locked out.
    let locked = env.operator.call(&id, "update_service").args_json(json!({"service": env.service()})).max_gas().transact().await?;
    assert!(locked.is_failure());

    // Bidding: reserve is 20% of what is outstanding, each bid beats the last by 5%.
    let low = env.pay(&env.carol, &agent, USD, json!({"action":"bid"})).await?;
    assert!(format!("{:?}", low.receipt_failures()).contains("lowest acceptable bid"));
    let carol_before = env.balance(env.carol.id()).await?;
    ok(env.pay(&env.carol, &agent, 20 * USD, json!({"action":"bid"})).await?)?;
    ok(env.pay(&env.vendor, &agent, 30 * USD, json!({"action":"bid"})).await?)?;
    assert_eq!(env.balance(env.carol.id()).await?, carol_before, "outbid money must come back");
    env.assert_solvent(&agent).await?;

    let early = env.alice.call(&id, "settle_auction").max_gas().transact().await?;
    assert!(early.is_failure());

    // A late bid extended the end only if it came within the anti-snipe window,
    // which these did, so read the true end instead of assuming.
    let ends = env.view(&agent).await?["current_loan"]["auction"]["ends_at"].as_u64().unwrap();
    let now = env.view(&agent).await?["now"].as_u64().unwrap();
    assert!(ends >= now);
    assert!(ends - now <= 601, "anti-snipe adds at most ten minutes");
    Ok(())
}

#[tokio::test]
async fn a_settled_sale_pays_lenders_and_hands_over_the_business() -> Result<()> {
    let env = Env::new().await?;
    let agent = env.create_agent("scout").await?;
    env.fund_with(&agent, env.fast_terms()).await?;
    let id: near_workspaces::AccountId = agent.parse()?;
    env.wait_secs(5).await?;
    ok(env.alice.call(&id, "foreclose").max_gas().transact().await?)?;

    // Carol pays more than the 45 USD still owed, so there is a surplus.
    ok(env.pay(&env.carol, &agent, 50 * USD, json!({"action":"bid"})).await?)?;
    env.wait_secs(5).await?;
    let op_before = env.balance(env.operator.id()).await?;
    ok(env.bob.call(&id, "settle_auction").max_gas().transact().await?)?;

    let view = env.view(&agent).await?;
    assert_eq!(view["operator"], env.carol.id().to_string());
    assert!(view["current_loan"].is_null());
    let loan: Value = env.worker.view(&id, "get_loan").args_json(json!({"loan_id":0})).await?.json()?;
    assert_eq!(loan["status"], "Sold");
    assert_eq!(s(&loan["repaid"]), 110 * USD);
    assert_eq!(env.balance(env.operator.id()).await?, op_before + 5 * USD, "surplus goes to the former operator");
    env.assert_solvent(&agent).await?;

    // The new owner has full control and the old one has none.
    let mut changed = env.service();
    changed["price"] = json!("2000000");
    ok(env.carol.call(&id, "update_service").args_json(json!({"service": changed})).max_gas().transact().await?)?;
    assert!(env.operator.call(&id, "update_service").args_json(json!({"service": env.service()})).max_gas().transact().await?.is_failure());

    // Same address, same inbox, new owner: it keeps earning with no redeploy.
    env.set_output(Some(job_output(json!([]))), false).await?;
    ok(env.pay(&env.bob, &agent, 2 * USD, json!({"action":"job","input":"new owner"})).await?)?;
    assert_eq!(env.view(&agent).await?["stats"]["jobs_done"], 1);

    // Lenders collect everything, and can do so after the loan closed.
    ok(env.alice.call(&id, "claim").args_json(json!({"loan_id":0})).max_gas().transact().await?)?;
    ok(env.bob.call(&id, "claim").args_json(json!({"loan_id":0})).max_gas().transact().await?)?;
    assert_eq!(env.balance(env.alice.id()).await?, 1_000 * USD - 60 * USD + 66 * USD);
    env.assert_solvent(&agent).await?;
    Ok(())
}

#[tokio::test]
async fn the_operator_can_redeem_a_foreclosed_business() -> Result<()> {
    let env = Env::new().await?;
    let agent = env.create_agent("scout").await?;
    env.fund_with(&agent, env.fast_terms()).await?;
    let id: near_workspaces::AccountId = agent.parse()?;
    env.wait_secs(5).await?;
    ok(env.carol.call(&id, "foreclose").max_gas().transact().await?)?;

    let carol_before = env.balance(env.carol.id()).await?;
    ok(env.pay(&env.carol, &agent, 20 * USD, json!({"action":"bid"})).await?)?;

    let op_before = env.balance(env.operator.id()).await?;
    ok(env.pay(&env.operator, &agent, 100 * USD, json!({"action":"repay"})).await?)?;
    // Only the debt was taken; the change came back.
    assert_eq!(env.balance(env.operator.id()).await?, op_before - 45 * USD);
    // The standing bid was returned.
    assert_eq!(env.balance(env.carol.id()).await?, carol_before);

    let view = env.view(&agent).await?;
    assert!(view["current_loan"].is_null());
    assert_eq!(view["operator"], env.operator.id().to_string());
    let loan: Value = env.worker.view(&id, "get_loan").args_json(json!({"loan_id":0})).await?.json()?;
    assert_eq!(loan["status"], "Repaid");
    env.assert_solvent(&agent).await?;

    // Lenders are made whole, with interest.
    ok(env.alice.call(&id, "claim").args_json(json!({"loan_id":0})).max_gas().transact().await?)?;
    ok(env.bob.call(&id, "claim").args_json(json!({"loan_id":0})).max_gas().transact().await?)?;
    assert_eq!(env.balance(env.alice.id()).await?, 1_000 * USD - 60 * USD + 66 * USD);
    assert_eq!(env.balance(env.bob.id()).await?, 1_000 * USD - 40 * USD + 44 * USD);
    env.assert_solvent(&agent).await?;
    Ok(())
}

#[tokio::test]
async fn a_cancelled_offer_returns_lender_money_through_the_claim_path() -> Result<()> {
    let env = Env::new().await?;
    let agent = env.create_agent("scout").await?;
    let id: near_workspaces::AccountId = agent.parse()?;
    ok(env.operator.call(&id, "create_offer").args_json(json!({"terms": env.terms()})).max_gas().transact().await?)?;
    ok(env.pay(&env.alice, &agent, 25 * USD, json!({"action":"fund","loan_id":0})).await?)?;
    assert_eq!(env.balance(env.alice.id()).await?, 975 * USD);
    ok(env.operator.call(&id, "cancel_offer").max_gas().transact().await?)?;
    ok(env.alice.call(&id, "claim").args_json(json!({"loan_id":0})).max_gas().transact().await?)?;
    assert_eq!(env.balance(env.alice.id()).await?, 1_000 * USD);
    env.assert_solvent(&agent).await?;
    Ok(())
}

#[tokio::test]
async fn nobody_can_call_the_private_callbacks() -> Result<()> {
    let env = Env::new().await?;
    let agent = env.create_agent("scout").await?;
    env.set_output(None, false).await?;
    let id: near_workspaces::AccountId = agent.parse()?;

    let forged = env.carol.call(&id, "on_job_result").args_json(json!({"job_id":0})).max_gas().transact().await?;
    assert!(failure_text(&forged).contains("private"));
    let forged = env.carol.call(&id, "on_push").args_json(json!({"account_id":env.carol.id(),"amount":"999"})).max_gas().transact().await?;
    assert!(failure_text(&forged).contains("private"));
    let fake = env.carol.call(&id, "ft_on_transfer").args_json(json!({"sender_id":env.carol.id(),"amount":"999","msg":"{\"action\":\"topup\"}"})).max_gas().transact().await?;
    assert!(failure_text(&fake).contains("configured token"));
    Ok(())
}
