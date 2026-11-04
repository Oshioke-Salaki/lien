//! Mimics the contract surface of OutLayer's `request_execution` for sandbox
//! tests: same arguments, same deposit, and a result set by the test. Live
//! behaviour is covered separately by the testnet end-to-end script.

use near_sdk::serde_json::Value;
use near_sdk::{env, near, AccountId, PanicOnDefault};

#[derive(PanicOnDefault)]
#[near(contract_state)]
pub struct MockOutLayer {
    /// JSON returned to the caller, or `None` to return null like a failed run.
    next_output: Option<String>,
    /// When set, the call panics like a refused request.
    fail: bool,
    calls: u32,
    last_input: Option<String>,
    last_source: Option<String>,
    last_secrets: Option<String>,
    last_response_format: Option<String>,
}

#[near]
impl MockOutLayer {
    #[init]
    pub fn new() -> Self {
        Self {
            next_output: None,
            fail: false,
            calls: 0,
            last_input: None,
            last_source: None,
            last_secrets: None,
            last_response_format: None,
        }
    }

    pub fn set_output(&mut self, output: Option<String>, fail: bool) {
        self.next_output = output;
        self.fail = fail;
    }

    #[payable]
    #[allow(clippy::too_many_arguments)]
    pub fn request_execution(
        &mut self,
        source: Value,
        resource_limits: Option<Value>,
        input_data: Option<String>,
        secrets_ref: Option<Value>,
        response_format: Option<String>,
        payer_account_id: Option<AccountId>,
        params: Option<Value>,
    ) -> Option<Value> {
        let _ = (payer_account_id, params);
        if self.fail {
            env::panic_str("mock outlayer refused the request");
        }
        assert!(resource_limits.is_some(), "without limits OutLayer only compiles");
        assert!(!env::attached_deposit().is_zero(), "OutLayer requires a deposit");
        self.calls += 1;
        self.last_input = input_data;
        self.last_source = Some(source.to_string());
        self.last_secrets = secrets_ref.map(|s| s.to_string());
        self.last_response_format = response_format;
        self.next_output.as_ref().map(|o| near_sdk::serde_json::from_str(o).expect("test set invalid JSON"))
    }

    pub fn get_calls(&self) -> u32 {
        self.calls
    }

    pub fn get_last(&self) -> (Option<String>, Option<String>, Option<String>, Option<String>) {
        (
            self.last_input.clone(),
            self.last_source.clone(),
            self.last_secrets.clone(),
            self.last_response_format.clone(),
        )
    }
}
