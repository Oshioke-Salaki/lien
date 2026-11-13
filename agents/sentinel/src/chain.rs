//! Reads account state from public NEAR RPC. Nothing here is taken on trust from
//! the customer: the target's state comes straight from the chain.

use serde_json::{json, Value};
use std::time::Duration;
use wasi_http_client::Client;

#[derive(Debug, Default, Clone, PartialEq)]
pub struct Facts {
    pub exists: bool,
    pub has_contract: bool,
    pub full_access_keys: u32,
    pub function_call_keys: u32,
    pub balance_near: u128,
    pub storage_bytes: u64,
}

/// Independent providers from NEAR's list. One free tier throttling (HTTP 429) or a node
/// failing must not fail a customer's paid check, so each read tries them in turn.
fn rpc_urls(network: &str) -> &'static [&'static str] {
    if network == "testnet" {
        &[
            "https://rpc.testnet.fastnear.com",
            "https://testnet-rpc.intea.rs",
            "https://near-testnet.drpc.org",
            "https://api.zan.top/near-testnet",
            "https://test.rpc.fastnear.com",
        ]
    } else {
        &["https://free.rpc.fastnear.com", "https://rpc.intea.rs", "https://near.drpc.org", "https://api.zan.top/near-mainnet"]
    }
}

fn query_one(url: &str, body: &str) -> Result<Value, String> {
    let response = Client::new()
        .post(url)
        .header("Content-Type", "application/json")
        .connect_timeout(Duration::from_secs(8))
        .body(body.as_bytes())
        .send()
        .map_err(|_| "the chain could not be reached".to_string())?;
    if !(200..300).contains(&response.status()) {
        return Err("the chain returned an error".to_string());
    }
    let bytes = response.body().map_err(|_| "the chain response could not be read".to_string())?;
    let value: Value = serde_json::from_slice(&bytes).map_err(|_| "the chain response was not valid".to_string())?;
    // A node problem (rate limit, timeout, not synced) is not an answer about the account.
    if let Some(error) = value.get("error") {
        let cause = error.pointer("/cause/name").and_then(Value::as_str).unwrap_or("");
        if cause != "UNKNOWN_ACCOUNT" {
            return Err("the chain node was busy".to_string());
        }
    }
    Ok(value)
}

/// Asks each provider in turn, twice round, and returns the first real answer.
fn query(urls: &[&str], params: Value) -> Result<Value, String> {
    let body = json!({ "jsonrpc": "2.0", "id": "sentinel", "method": "query", "params": params }).to_string();
    let mut last = "the chain could not be reached".to_string();
    for _round in 0..2 {
        for url in urls {
            match query_one(url, &body) {
                Ok(value) => return Ok(value),
                Err(error) => last = error,
            }
        }
    }
    Err(last)
}

fn view_account(urls: &[&str], account: &str) -> Result<Option<Value>, String> {
    let reply = query(urls, json!({ "request_type": "view_account", "finality": "final", "account_id": account }))?;
    Ok(reply.get("result").filter(|r| r.get("amount").is_some()).cloned())
}

fn view_keys(urls: &[&str], account: &str) -> Result<Value, String> {
    let reply = query(urls, json!({ "request_type": "view_access_key_list", "finality": "final", "account_id": account }))?;
    reply.get("result").cloned().ok_or_else(|| "keys could not be read".to_string())
}

pub fn read_account(account: &str, network: &str) -> Result<Facts, String> {
    let urls = rpc_urls(network);
    let Some(state) = view_account(urls, account)? else {
        return Ok(Facts::default());
    };
    let keys = view_keys(urls, account)?;
    Ok(parse_facts(&state, &keys))
}

const NO_CODE: &str = "11111111111111111111111111111111";

pub fn parse_facts(state: &Value, keys: &Value) -> Facts {
    let (mut full, mut limited) = (0, 0);
    for key in keys["keys"].as_array().into_iter().flatten() {
        if key["access_key"]["permission"] == "FullAccess" {
            full += 1;
        } else {
            limited += 1;
        }
    }
    let code_hash = state["code_hash"].as_str().unwrap_or(NO_CODE);
    // Accounts on global contract code report a zero code hash and a global field.
    let global = state["global_contract_hash"].is_string() || state["global_contract_account_id"].is_string();
    let yocto: u128 = state["amount"].as_str().and_then(|a| a.parse().ok()).unwrap_or(0);
    Facts {
        exists: true,
        has_contract: code_hash != NO_CODE || global,
        full_access_keys: full,
        function_call_keys: limited,
        balance_near: yocto / 1_000_000_000_000_000_000_000_000,
        storage_bytes: state["storage_usage"].as_u64().unwrap_or(0),
    }
}
