//! The only way tokens leave this contract.
//!
//! Money owed is first written to a per-account credit, then pushed. If the
//! transfer fails (the recipient is not registered with the token, say) the
//! credit comes back and the owner can retry with `withdraw`. So a recipient
//! that cannot be paid can never block a job, a repayment or a foreclosure.

use crate::{errors, AgentContract, AgentContractExt};
use near_sdk::json_types::U128;
use near_sdk::{env, ext_contract, near, require, AccountId, Gas, NearToken};

const GAS_FT_TRANSFER: Gas = Gas::from_tgas(15);
const GAS_ON_PUSH: Gas = Gas::from_tgas(5);
/// Below this much remaining gas a push is left for a later `withdraw`.
const GAS_PUSH_MIN: Gas = Gas::from_tgas(25);

#[ext_contract(ext_token)]
#[allow(dead_code)]
trait Token {
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>);
}

#[near]
impl AgentContract {
    /// Pays out everything owed to an account. Anyone can call it, and the
    /// money only ever goes to the account it is owed to.
    pub fn withdraw(&mut self, account_id: AccountId) {
        require!(
            self.credits.get(&account_id).copied().unwrap_or(0) > 0,
            errors::NOTHING_TO_WITHDRAW
        );
        require!(self.push(&account_id), "not enough gas attached to pay out");
    }

    #[private]
    pub fn on_push(&mut self, account_id: AccountId, amount: U128) {
        if !near_sdk::is_promise_success() {
            self.credit(&account_id, amount.0);
        }
    }
}

impl AgentContract {
    pub(crate) fn credit(&mut self, account: &AccountId, amount: u128) {
        if amount == 0 {
            return;
        }
        let balance = self.credits.get(account).copied().unwrap_or(0);
        self.credits.insert(account.clone(), balance + amount);
        self.ledger.credits.0 += amount;
    }

    /// Tries to send an account its credit. Returns false if there was not
    /// enough gas left, in which case the credit simply stays.
    pub(crate) fn push(&mut self, account: &AccountId) -> bool {
        let used = env::used_gas().as_gas();
        let left = env::prepaid_gas().as_gas().saturating_sub(used);
        if left < GAS_PUSH_MIN.as_gas() {
            return false;
        }
        let Some(amount) = self.credits.remove(account).filter(|a| *a > 0) else {
            return true;
        };
        self.ledger.credits.0 -= amount;
        #[cfg(test)]
        crate::tests::record_push(amount);
        ext_token::ext(self.token.clone())
            .with_attached_deposit(NearToken::from_yoctonear(1))
            .with_static_gas(GAS_FT_TRANSFER)
            .ft_transfer(account.clone(), U128(amount), None)
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(GAS_ON_PUSH)
                    .on_push(account.clone(), U128(amount)),
            )
            .detach();
        true
    }
}
