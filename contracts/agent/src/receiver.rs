//! Every token enters through here, and the message says what it is for.

use crate::{errors, AgentContract, AgentContractExt};
use near_sdk::json_types::U128;
use near_sdk::serde::Deserialize;
use near_sdk::{env, near, require, serde_json, AccountId, PromiseOrValue};

#[derive(Deserialize)]
#[serde(crate = "near_sdk::serde", tag = "action", rename_all = "snake_case")]
enum TransferMsg {
    /// Lend to a loan.
    Fund { loan_id: u32 },
    /// Buy one job.
    Job { input: String },
    /// Pay down the debt directly.
    Repay,
    /// Bid for a foreclosed business.
    Bid,
    /// Income earned elsewhere, usually forwarded by the collector.
    Revenue,
    /// Add working capital.
    Topup,
}

#[near]
impl AgentContract {
    /// NEP-141 receiver. A panic here refunds the sender in full, so invalid
    /// requests simply bounce. Returns what the token should send back.
    pub fn ft_on_transfer(&mut self, sender_id: AccountId, amount: U128, msg: String) -> PromiseOrValue<U128> {
        require!(env::predecessor_account_id() == self.token, errors::NOT_TOKEN);
        Self::assert_amount(amount.0);
        let parsed: TransferMsg = serde_json::from_str(&msg)
            .unwrap_or_else(|_| env::panic_str("unrecognised transfer message"));
        let unused = match parsed {
            TransferMsg::Fund { loan_id } => self.accept_funding(sender_id, amount.0, loan_id),
            TransferMsg::Job { input } => self.start_job(sender_id, amount.0, input),
            TransferMsg::Repay => self.accept_repayment(sender_id, amount.0),
            TransferMsg::Bid => {
                self.accept_bid(sender_id, amount.0);
                0
            }
            TransferMsg::Revenue => {
                self.stats.external_revenue.0 += amount.0;
                self.recognize_revenue(amount.0, "external");
                0
            }
            TransferMsg::Topup => {
                self.ledger.opex.0 += amount.0;
                0
            }
        };
        PromiseOrValue::Value(U128(unused))
    }
}
