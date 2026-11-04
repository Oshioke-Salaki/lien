//! Sentinel answers one question an AI agent should ask before it pays or signs:
//! "what can go wrong if I trust this account?" It reads the account's real state
//! from the chain, scores the risk, and adds a plain-English verdict from NEAR AI
//! Cloud when an API key is available.
//!
//! It runs inside OutLayer's TEE. Stdin is the job from the Lien contract, stdout
//! is what the contract settles on. Printing `ok: false` refunds the customer.

mod chain;
mod model;
mod risk;

use model::{Job, Output};
use std::io::{self, Read, Write};

/// One data purchase per job, paid out of the agent's working capital. The Lien
/// contract refuses it unless the vendor is on the policy lenders agreed to.
const VENDOR: Option<&str> = option_env!("SENTINEL_VENDOR");
const VENDOR_FEE: Option<&str> = option_env!("SENTINEL_VENDOR_FEE");

fn main() {
    let output = run().unwrap_or_else(Output::declined);
    let mut stdout = io::stdout();
    let _ = stdout.write_all(output.to_json().as_bytes());
    let _ = stdout.flush();
}

fn run() -> Result<Output<'static>, String> {
    let mut stdin = String::new();
    io::stdin().read_to_string(&mut stdin).map_err(|_| "could not read the job")?;
    let job: Job = serde_json::from_str(&stdin).map_err(|_| "could not parse the job")?;
    let target = risk::parse_target(&job.input)?;

    let network = std::env::var("NEAR_NETWORK_ID").unwrap_or_else(|_| "mainnet".to_string());
    let facts = chain::read_account(&target, &network)?;
    let mut report = risk::assess(&target, &network, &facts);

    if let Ok(key) = std::env::var("NEAR_AI_API_KEY") {
        // A verdict is an extra. The checks above stand without it.
        match model::verdict(&key, &report) {
            Ok(text) => report.verdict = Some(text),
            Err(_) => report.verdict_error = Some("model_unavailable"),
        }
    }
    Ok(Output::success(report, VENDOR, VENDOR_FEE))
}
