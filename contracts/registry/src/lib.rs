//! Creates agent businesses and lists them.
//!
//! Each business is a sub-account running the same published code and holding
//! no access keys, so no one (the registry included) can change or move what it
//! holds. Each one is isolated: a problem in one cannot reach another's money.

use near_sdk::json_types::Base58CryptoHash;
use near_sdk::serde_json::{json, Value};
use near_sdk::store::Vector;
use near_sdk::{env, near, require, AccountId, BorshStorageKey, CryptoHash, Gas, NearToken, PanicOnDefault, Promise};

/// Storage for both accounts, token registration and an initial compute tank.
const MIN_DEPOSIT: NearToken = NearToken::from_millinear(500);
const COLLECTOR_BALANCE: NearToken = NearToken::from_millinear(50);
const TOKEN_REGISTRATION: NearToken = NearToken::from_micronear(1_250);
const GAS_INIT_AGENT: Gas = Gas::from_tgas(30);
const GAS_INIT_COLLECTOR: Gas = Gas::from_tgas(15);
const GAS_REGISTER: Gas = Gas::from_tgas(8);
const GAS_ON_CREATED: Gas = Gas::from_tgas(25);
const MAX_LABEL: usize = 32;
const MAX_RESULT_LEN: usize = 1_024;

#[derive(BorshStorageKey)]
#[near]
enum StorageKey {
    Agents,
}

#[derive(PanicOnDefault)]
#[near(contract_state)]
pub struct Registry {
    token: AccountId,
    outlayer: AccountId,
    agent_code: CryptoHash,
    collector_code: CryptoHash,
    agents: Vector<AccountId>,
}

#[near(serializers = [json])]
pub struct RegistryConfig {
    pub token: AccountId,
    pub outlayer: AccountId,
    pub agent_code: Base58CryptoHash,
    pub collector_code: Base58CryptoHash,
    pub agent_count: u32,
}

#[near]
impl Registry {
    /// `agent_code` and `collector_code` are global contract hashes. They are
    /// fixed here so every business provably runs the same code.
    #[init]
    pub fn new(
        token: AccountId,
        outlayer: AccountId,
        agent_code: Base58CryptoHash,
        collector_code: Base58CryptoHash,
    ) -> Self {
        Self {
            token,
            outlayer,
            agent_code: agent_code.into(),
            collector_code: collector_code.into(),
            agents: Vector::new(StorageKey::Agents),
        }
    }

    /// `service` is passed through and validated by the agent's own constructor.
    /// Creates `<label>.<registry>` and its inbox `<label>-in.<registry>`. Both
    /// are created together or the deposit goes back to the caller. The caller
    /// becomes the operator, and everything above the setup cost becomes the
    /// agent's compute tank.
    #[payable]
    pub fn create_agent(
        &mut self,
        label: String,
        name: String,
        description: String,
        source_url: String,
        service: Value,
    ) -> Promise {
        let deposit = env::attached_deposit();
        require!(deposit >= MIN_DEPOSIT, "attach at least 0.5 NEAR");
        require!(is_label(&label), "label must be 2 to 32 lowercase letters, digits or single hyphens");

        let operator = env::predecessor_account_id();
        let agent = sub_account(&label);
        let collector = sub_account(&format!("{label}-in"));
        let agent_balance = deposit.saturating_sub(COLLECTOR_BALANCE).saturating_sub(TOKEN_REGISTRATION.saturating_mul(2));

        let agent_args = json!({
            "token": self.token,
            "outlayer": self.outlayer,
            "collector": collector,
            "operator": operator,
            "name": name,
            "description": description,
            "source_url": source_url,
            "service": service,
        });
        let collector_args = json!({ "agent": agent, "token": self.token });
        let register = |account: &AccountId| {
            Promise::new(self.token.clone()).function_call(
                "storage_deposit".to_string(),
                json!({ "account_id": account, "registration_only": true }).to_string().into_bytes(),
                TOKEN_REGISTRATION,
                GAS_REGISTER,
            )
        };

        // Joined rather than chained: a `.then` step runs even if the one before it
        // failed, and its callback only sees the last result. Joined, the callback
        // sees every step and can refund exactly what did not land.
        let create_agent = Promise::new(agent.clone())
            .create_account()
            .transfer(agent_balance)
            .use_global_contract(self.agent_code)
            .function_call("new".to_string(), agent_args.to_string().into_bytes(), NearToken::from_yoctonear(0), GAS_INIT_AGENT);
        let create_collector = Promise::new(collector.clone())
            .create_account()
            .transfer(COLLECTOR_BALANCE)
            .use_global_contract(self.collector_code)
            .function_call("new".to_string(), collector_args.to_string().into_bytes(), NearToken::from_yoctonear(0), GAS_INIT_COLLECTOR);

        create_agent
            .and(create_collector)
            .and(register(&agent))
            .and(register(&collector))
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(GAS_ON_CREATED)
                    .on_created(agent, operator, agent_balance),
            )
    }

    /// Lists the business only if every step succeeded, and returns the NEAR of
    /// any step that failed. Failed account creations send their NEAR back to
    /// this contract, so that is what gets refunded.
    #[private]
    pub fn on_created(&mut self, agent: AccountId, operator: AccountId, agent_balance: NearToken) -> Option<AccountId> {
        let costs = [agent_balance, COLLECTOR_BALANCE, TOKEN_REGISTRATION, TOKEN_REGISTRATION];
        let mut refund = NearToken::from_yoctonear(0);
        for (i, cost) in costs.into_iter().enumerate() {
            if env::promise_result_checked(i as u64, MAX_RESULT_LEN).is_err() {
                refund = refund.saturating_add(cost);
            }
        }
        if !refund.is_zero() {
            env::log_str(&format!("could not fully create {agent}; returning {refund}"));
            Promise::new(operator).transfer(refund).detach();
            return None;
        }
        self.agents.push(agent.clone());
        env::log_str(&format!(
            "EVENT_JSON:{}",
            json!({ "standard": "lien", "version": "1.0.0", "event": "agent_created", "data": { "agent": agent, "operator": operator } })
        ));
        Some(agent)
    }

    /// Businesses, newest first.
    pub fn get_agents(&self, from: Option<u32>, limit: Option<u32>) -> Vec<AccountId> {
        let count = self.agents.len();
        let start = from.unwrap_or(count).min(count);
        let limit = limit.unwrap_or(50).min(100);
        (0..start).rev().take(limit as usize).filter_map(|i| self.agents.get(i).cloned()).collect()
    }

    pub fn get_config(&self) -> RegistryConfig {
        RegistryConfig {
            token: self.token.clone(),
            outlayer: self.outlayer.clone(),
            agent_code: self.agent_code.into(),
            collector_code: self.collector_code.into(),
            agent_count: self.agents.len(),
        }
    }
}

fn sub_account(label: &str) -> AccountId {
    format!("{label}.{}", env::current_account_id())
        .parse()
        .unwrap_or_else(|_| env::panic_str("that label does not make a valid account name"))
}

/// The label plus `-in` must also be valid, hence the limits and no edge hyphens.
fn is_label(label: &str) -> bool {
    let bytes = label.as_bytes();
    (2..=MAX_LABEL).contains(&bytes.len())
        && bytes.iter().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || *b == b'-')
        && bytes[0] != b'-'
        && bytes[bytes.len() - 1] != b'-'
        && !label.contains("--")
}

#[cfg(test)]
mod tests {
    use super::is_label;

    #[test]
    fn labels() {
        for ok in ["ab", "scout", "scout-2", "a1", &"a".repeat(32)] {
            assert!(is_label(ok), "{ok}");
        }
        for bad in ["a", "", "-ab", "ab-", "a--b", "AB", "a.b", "a_b", &"a".repeat(33)] {
            assert!(!is_label(bad), "{bad}");
        }
    }
}
