//! A sandbox with the token, a stand-in for OutLayer, published global code and
//! the registry, plus the helpers the scenarios share.
#![allow(dead_code)]

use anyhow::Result;
use near_workspaces::network::Sandbox;
use near_workspaces::result::ExecutionFinalResult;
use near_workspaces::types::NearToken;
use near_workspaces::{Account, Contract, Worker};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::path::Path;

pub const USD: u128 = 1_000_000;

pub struct Env {
    pub worker: Worker<Sandbox>,
    pub token: Contract,
    pub outlayer: Contract,
    pub registry: Contract,
    pub operator: Account,
    pub alice: Account,
    pub bob: Account,
    pub carol: Account,
    pub vendor: Account,
}

fn wasm(name: &str) -> Result<Vec<u8>> {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    let path = root.join(format!("target/near/{name}/{name}.wasm"));
    std::fs::read(&path).map_err(|e| anyhow::anyhow!("{}: {e}. Run scripts/build.sh first.", path.display()))
}

fn code_hash(code: &[u8]) -> String {
    bs58::encode(Sha256::digest(code)).into_string()
}

pub fn ok(result: ExecutionFinalResult) -> Result<()> {
    if result.is_failure() {
        anyhow::bail!("transaction failed: {:#?}", result.failures());
    }
    Ok(())
}

pub fn failure_text(result: &ExecutionFinalResult) -> String {
    format!("{:?}", result.failures())
}

impl Env {
    pub async fn new() -> Result<Self> {
        let worker = near_workspaces::sandbox().await?;
        let root = worker.root_account()?;

        let token = worker.dev_deploy(&wasm("lien_mock_token")?).await?;
        ok(token.call("new").transact().await?)?;

        let outlayer = root
            .create_subaccount("outlayer")
            .initial_balance(NearToken::from_near(1_000))
            .transact()
            .await?
            .into_result()?
            .deploy(&wasm("lien_mock_outlayer")?)
            .await?
            .into_result()?;
        ok(outlayer.call("new").transact().await?)?;

        let agent_code = wasm("lien_agent")?;
        let collector_code = wasm("lien_collector")?;
        for code in [&agent_code, &collector_code] {
            ok(outlayer.call("publish_code").args(code.clone()).max_gas().transact().await?)?;
        }

        let registry = root
            .create_subaccount("lien")
            .initial_balance(NearToken::from_near(500))
            .transact()
            .await?
            .into_result()?
            .deploy(&wasm("lien_registry")?)
            .await?
            .into_result()?;
        ok(registry
            .call("new")
            .args_json(json!({
                "token": token.id(),
                "outlayer": outlayer.id(),
                "agent_code": code_hash(&agent_code),
                "collector_code": code_hash(&collector_code),
            }))
            .transact()
            .await?)?;

        let mut people = Vec::new();
        for name in ["operator", "alice", "bob", "carol", "vendor"] {
            let account = root
                .create_subaccount(name)
                .initial_balance(NearToken::from_near(100))
                .transact()
                .await?
                .into_result()?;
            people.push(account);
        }
        let [operator, alice, bob, carol, vendor]: [Account; 5] =
            people.try_into().map_err(|_| anyhow::anyhow!("five accounts"))?;

        let env = Self { worker, token, outlayer, registry, operator, alice, bob, carol, vendor };
        for account in [&env.operator, &env.alice, &env.bob, &env.carol, &env.vendor] {
            env.register(account).await?;
            env.mint(account, 1_000 * USD).await?;
        }
        Ok(env)
    }

    pub async fn register(&self, account: &Account) -> Result<()> {
        ok(account
            .call(self.token.id(), "storage_deposit")
            .args_json(json!({ "account_id": account.id() }))
            .deposit(NearToken::from_millinear(2))
            .transact()
            .await?)?;
        Ok(())
    }

    pub async fn mint(&self, account: &Account, amount: u128) -> Result<()> {
        ok(self
            .token
            .call("faucet")
            .args_json(json!({ "account_id": account.id(), "amount": amount.to_string() }))
            .transact()
            .await?)?;
        Ok(())
    }

    pub fn service(&self) -> Value {
        json!({
            "wasm": {
                "url": "https://example.com/sentinel.wasm",
                "hash": "a".repeat(64),
                "build_target": "wasm32-wasip2",
            },
            "price": (USD).to_string(),
            "max_instructions": 10_000_000_000u64,
            "max_memory_mb": 128,
            "max_execution_seconds": 60,
            "compute_deposit": NearToken::from_millinear(20).as_yoctonear().to_string(),
            "secrets_profile": null,
            "policy": {
                "vendors": [self.vendor.id()],
                "max_per_tx": (USD / 2).to_string(),
                "max_per_day": (5 * USD).to_string(),
            },
        })
    }

    /// Terms with slow windows, for tests that are not about falling behind.
    pub fn terms(&self) -> Value {
        let mut terms = self.fast_terms();
        terms["term_secs"] = json!(90_000);
        terms["window_secs"] = json!(86_400);
        terms
    }

    /// Terms that fall behind within seconds, for foreclosure tests.
    pub fn fast_terms(&self) -> Value {
        json!({
            "principal": (100 * USD).to_string(),
            "total_due": (110 * USD).to_string(),
            "lender_bps": 3_000,
            "operator_bps": 2_000,
            "funding_secs": 3_600,
            "term_secs": 3_000,
            "window_secs": 2,
            "min_payment_per_window": (10 * USD).to_string(),
            "grace_secs": 2,
            "auction_secs": 3,
            "auction_reserve_bps": 2_000,
        })
    }

    /// Creates a business through the registry, the way a real operator does.
    pub async fn create_agent(&self, label: &str) -> Result<String> {
        let result = self
            .operator
            .call(self.registry.id(), "create_agent")
            .args_json(json!({
                "label": label,
                "name": "Sentinel",
                "description": "Pre-flight account checks",
                "source_url": "https://github.com/Oshioke-Salaki/lien",
                "service": self.service(),
            }))
            .deposit(NearToken::from_near(5))
            .max_gas()
            .transact()
            .await?;
        ok(result)?;
        Ok(format!("{label}.{}", self.registry.id()))
    }

    pub async fn pay(&self, from: &Account, to: &str, amount: u128, msg: Value) -> Result<ExecutionFinalResult> {
        Ok(from
            .call(self.token.id(), "ft_transfer_call")
            .args_json(json!({ "receiver_id": to, "amount": amount.to_string(), "msg": msg.to_string() }))
            .deposit(NearToken::from_yoctonear(1))
            .max_gas()
            .transact()
            .await?)
    }

    pub async fn balance(&self, account: impl AsRef<str>) -> Result<u128> {
        let account = account.as_ref();
        let v: Value = self
            .worker
            .view(self.token.id(), "ft_balance_of")
            .args_json(json!({ "account_id": account }))
            .await?
            .json()?;
        Ok(v.as_str().unwrap().parse()?)
    }

    pub async fn view(&self, agent: &str) -> Result<Value> {
        Ok(self.worker.view(&agent.parse()?, "get_agent").await?.json()?)
    }

    pub async fn set_output(&self, output: Option<Value>, fail: bool) -> Result<()> {
        ok(self
            .outlayer
            .call("set_output")
            .args_json(json!({ "output": output.map(|o| o.to_string()), "fail": fail }))
            .transact()
            .await?)?;
        Ok(())
    }

    /// The contract's own accounting must never claim more than it holds.
    pub async fn assert_solvent(&self, agent: &str) -> Result<()> {
        let view = self.view(agent).await?;
        let ledger = &view["ledger"];
        let total: u128 = ["opex", "operator", "lender_pool", "funding_escrow", "job_escrow", "auction_escrow", "credits"]
            .iter()
            .map(|k| ledger[k].as_str().unwrap().parse::<u128>().unwrap())
            .sum();
        let held = self.balance(agent).await?;
        assert!(held >= total, "agent holds {held} but its ledger says {total}: {ledger}");
        Ok(())
    }

    pub async fn fund_fully(&self, agent: &str) -> Result<()> {
        self.fund_with(agent, self.terms()).await
    }

    pub async fn fund_with(&self, agent: &str, terms: Value) -> Result<()> {
        ok(self.operator.call(&agent.parse()?, "create_offer").args_json(json!({ "terms": terms })).max_gas().transact().await?)?;
        ok(self.pay(&self.alice, agent, 60 * USD, json!({"action":"fund","loan_id":0})).await?)?;
        ok(self.pay(&self.bob, agent, 40 * USD, json!({"action":"fund","loan_id":0})).await?)?;
        Ok(())
    }

    /// Waits for real chain time to pass.
    pub async fn wait_secs(&self, secs: u64) -> Result<()> {
        tokio::time::sleep(std::time::Duration::from_secs(secs)).await;
        Ok(())
    }
}
