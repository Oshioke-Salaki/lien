//! The address a business gives out for income earned anywhere: a plain token
//! transfer, or a NEAR Intents swap from another chain, arrives here.
//!
//! This is a separate account on purpose. A contract that holds customer and
//! lender money cannot safely work out "new income" from its own balance: a
//! `ft_transfer_call` credits the balance a receipt before the contract hears
//! about it, so reading the balance in between would count that money twice.
//! This account has no ledger, so there is nothing to double count. It sends
//! whatever it holds through the agent's front door.

use near_sdk::json_types::U128;
use near_sdk::{env, ext_contract, near, AccountId, Gas, NearToken, PanicOnDefault, Promise, PromiseError, PromiseOrValue};

const GAS_BALANCE: Gas = Gas::from_tgas(5);
const GAS_ON_BALANCE: Gas = Gas::from_tgas(100);
const GAS_TRANSFER_CALL: Gas = Gas::from_tgas(70);
const REVENUE_MSG: &str = r#"{"action":"revenue"}"#;

#[ext_contract(ext_token)]
#[allow(dead_code)]
trait Token {
    fn ft_balance_of(&self, account_id: AccountId) -> U128;
    fn ft_transfer_call(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>, msg: String) -> U128;
}

#[derive(PanicOnDefault)]
#[near(contract_state)]
pub struct Collector {
    agent: AccountId,
    token: AccountId,
}

#[near]
impl Collector {
    #[init]
    pub fn new(agent: AccountId, token: AccountId) -> Self {
        Self { agent, token }
    }

    /// Sends the whole balance to the agent as revenue. Anyone can call this,
    /// and the money can only ever go to the agent.
    pub fn forward(&mut self) -> Promise {
        ext_token::ext(self.token.clone())
            .with_static_gas(GAS_BALANCE)
            .ft_balance_of(env::current_account_id())
            .then(Self::ext(env::current_account_id()).with_static_gas(GAS_ON_BALANCE).on_balance())
    }

    #[private]
    pub fn on_balance(&mut self, #[callback_result] balance: Result<U128, PromiseError>) -> PromiseOrValue<U128> {
        let amount = balance.map_or(0, |b| b.0);
        if amount == 0 {
            return PromiseOrValue::Value(U128(0));
        }
        let transfer = ext_token::ext(self.token.clone())
            .with_attached_deposit(NearToken::from_yoctonear(1))
            .with_static_gas(GAS_TRANSFER_CALL)
            .ft_transfer_call(self.agent.clone(), U128(amount), None, REVENUE_MSG.to_string());
        PromiseOrValue::Promise(transfer)
    }

    pub fn get_config(&self) -> (AccountId, AccountId) {
        (self.agent.clone(), self.token.clone())
    }
}
