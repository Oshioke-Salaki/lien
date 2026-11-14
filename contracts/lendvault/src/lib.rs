//! A keyless lending vault for an autonomous lender agent.
//!
//! The account that runs this contract holds no access keys. It holds the
//! agent's lending budget in the test dollar and lends it, from its own
//! balance and in its own name, only when the policy fixed at init allows.
//! There is no owner, no setter and no upgrade method.
//!
//! Why it exists: on NEAR a function-call access key cannot attach a deposit,
//! and `ft_transfer_call` needs exactly 1 yoctoNEAR, so an agent that lends
//! directly must hold a full-access key. Here the agent calls `lend` with no
//! deposit (a function-call key is enough) and the vault attaches the
//! 1 yoctoNEAR itself, after checking:
//!
//! - the caller is the agent fixed at init;
//! - the amount is within `max_per_loan` and what is left of `total_budget`;
//! - the business is listed by the registry fixed at init (a cross-contract
//!   view of `get_agents`), uses the same token and registry, and has a loan
//!   that is raising (`get_agent`: status `Funding`, before its deadline);
//! - the vault's note on that loan stays within `max_share_bps` of the
//!   principal, and the amount is no more than the loan still needs.
//!
//! Money leaves this contract in exactly two ways: `ft_transfer_call` to a
//! listed business with the `fund` message, and `ft_transfer` to the
//! beneficiary fixed at init. Notes are in the vault's name, so repayments
//! come back here (`claim`).
//!
//! What it cannot check: a contract cannot read another account's access
//! keys. The vault relies on the registry instead: the registry creates every
//! business in one batch with no AddKey action, and the business code has no
//! method that adds a key. The registry account itself is trusted to list
//! only the businesses it created.

use near_sdk::json_types::U128;
use near_sdk::serde_json::{self, json};
use near_sdk::store::IterableMap;
use near_sdk::{
    env, near, require, AccountId, BorshStorageKey, Gas, NearToken, PanicOnDefault, Promise, PromiseError,
};

/// How many businesses one `get_agents` page returns at most (the registry's own cap).
pub const REGISTRY_PAGE: u32 = 100;
pub const BPS: u128 = 10_000;

const GAS_VIEW_REGISTRY: Gas = Gas::from_tgas(10);
const GAS_VIEW_AGENT: Gas = Gas::from_tgas(15);
const GAS_ON_CHECKED: Gas = Gas::from_tgas(110);
const GAS_FT_TRANSFER_CALL: Gas = Gas::from_tgas(80);
const GAS_ON_LENT: Gas = Gas::from_tgas(10);
const GAS_CLAIM: Gas = Gas::from_tgas(60);
const GAS_ON_CLAIMED: Gas = Gas::from_tgas(10);
const GAS_FORECLOSE: Gas = Gas::from_tgas(60);
const GAS_FT_TRANSFER: Gas = Gas::from_tgas(15);
const GAS_ON_WITHDRAWN: Gas = Gas::from_tgas(10);
const ONE_YOCTO: NearToken = NearToken::from_yoctonear(1);

#[derive(BorshStorageKey)]
#[near]
enum StorageKey {
    Positions,
}

/// Fixed at init, forever.
#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq)]
pub struct Policy {
    /// The NEP-141 token the vault holds and lends.
    pub token: AccountId,
    /// The Lien registry. Only businesses it lists can receive a loan.
    pub registry: AccountId,
    /// The only account withdrawals can go to.
    pub beneficiary: AccountId,
    /// The only account that can call `lend`.
    pub agent: AccountId,
    /// The most one `lend` call can send.
    pub max_per_loan: U128,
    /// The most the vault's note on one loan can be, as a share of that loan's principal.
    pub max_share_bps: u16,
    /// The most the vault can ever lend in total, counting only what businesses accepted.
    pub total_budget: U128,
}

/// The vault's note on one loan of one business.
#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq, Default)]
pub struct Position {
    /// Principal the business accepted.
    pub principal: U128,
    /// Sent and not yet settled.
    pub in_flight: U128,
    /// Repayments received through `claim`.
    pub claimed: U128,
}

#[near(serializers = [json])]
pub struct PositionView {
    pub business: AccountId,
    pub loan_id: u32,
    #[serde(flatten)]
    pub position: Position,
}

#[near(serializers = [json])]
pub struct Totals {
    /// Principal businesses accepted, lifetime. Counts against `total_budget`.
    pub lent: U128,
    /// Sent and not yet settled. Also counts against `total_budget`.
    pub in_flight: U128,
    /// Sent and returned unused by the business (refunds).
    pub refunded: U128,
    /// Repayments received through `claim`.
    pub claimed: U128,
    /// Paid to the beneficiary.
    pub withdrawn: U128,
    /// What `total_budget` still allows.
    pub budget_left: U128,
    pub lends: u32,
}

/// The few fields of a business's `get_agent` the vault reads. Other fields are ignored.
#[near(serializers = [json])]
pub struct AgentLite {
    pub registry: AccountId,
    pub token: AccountId,
    pub current_loan: Option<LoanLite>,
    pub now: u64,
}

#[near(serializers = [json])]
pub struct LoanLite {
    pub id: u32,
    pub status: String,
    pub terms: TermsLite,
    pub funded: U128,
    pub funding_deadline: u64,
}

#[near(serializers = [json])]
pub struct TermsLite {
    pub principal: U128,
}

#[derive(PanicOnDefault)]
#[near(contract_state)]
pub struct LendVault {
    policy: Policy,
    positions: IterableMap<(AccountId, u32), Position>,
    lent: u128,
    in_flight: u128,
    refunded: u128,
    claimed: u128,
    withdrawn: u128,
    lends: u32,
}

#[near]
impl LendVault {
    /// Sets the policy once. There is no method that changes it later.
    #[init]
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        token: AccountId,
        registry: AccountId,
        beneficiary: AccountId,
        agent: AccountId,
        max_per_loan: U128,
        max_share_bps: u16,
        total_budget: U128,
    ) -> Self {
        require!(max_per_loan.0 > 0, "max_per_loan must be positive");
        require!(total_budget.0 >= max_per_loan.0, "total_budget must be at least max_per_loan");
        require!(max_share_bps > 0 && max_share_bps as u128 <= BPS, "max_share_bps must be between 1 and 10000");
        let me = env::current_account_id();
        require!(agent != me && beneficiary != me, "the agent and the beneficiary must be other accounts");
        Self {
            policy: Policy { token, registry, beneficiary, agent, max_per_loan, max_share_bps, total_budget },
            positions: IterableMap::new(StorageKey::Positions),
            lent: 0,
            in_flight: 0,
            refunded: 0,
            claimed: 0,
            withdrawn: 0,
            lends: 0,
        }
    }

    // ---------- views ----------

    pub fn get_policy(&self) -> Policy {
        self.policy.clone()
    }

    pub fn get_totals(&self) -> Totals {
        Totals {
            lent: U128(self.lent),
            in_flight: U128(self.in_flight),
            refunded: U128(self.refunded),
            claimed: U128(self.claimed),
            withdrawn: U128(self.withdrawn),
            budget_left: U128(self.budget_left()),
            lends: self.lends,
        }
    }

    pub fn get_position(&self, business: AccountId, loan_id: u32) -> Option<Position> {
        self.positions.get(&(business, loan_id)).cloned()
    }

    pub fn get_positions(&self, from: Option<u32>, limit: Option<u32>) -> Vec<PositionView> {
        self.positions
            .iter()
            .skip(from.unwrap_or(0) as usize)
            .take(limit.unwrap_or(50).min(100) as usize)
            .map(|((business, loan_id), position)| PositionView {
                business: business.clone(),
                loan_id: *loan_id,
                position: position.clone(),
            })
            .collect()
    }

    // ---------- the agent's calls ----------

    /// Lends `amount` of the vault's tokens to `business`'s loan that is raising.
    /// Only the agent can call it, and it takes no deposit, so a function-call
    /// key works. Attach about 300 Tgas. `registry_from` is passed to the
    /// registry's `get_agents` as `from`, for when the registry lists more
    /// businesses than one page; leave it out otherwise. The transaction's
    /// result is the amount the business accepted.
    pub fn lend(&mut self, business: AccountId, amount: U128, registry_from: Option<u32>) -> Promise {
        // The SDK already refuses a deposit on a method that is not payable; this
        // repeats it so the rule holds even if the method is ever marked payable.
        require!(env::attached_deposit().is_zero(), "refused: lend takes no deposit");
        self.assert_agent();
        let p = &self.policy;
        require!(amount.0 > 0, "refused: the amount must be positive");
        if amount.0 > p.max_per_loan.0 {
            env::panic_str(&format!("refused: {} is above max_per_loan {}", amount.0, p.max_per_loan.0));
        }
        if amount.0 > self.budget_left() {
            env::panic_str(&format!("refused: {} is above what is left of total_budget ({})", amount.0, self.budget_left()));
        }
        if !is_direct_sub_account(&business, &p.registry) {
            env::panic_str(&format!("refused: {business} is not a Lien business (not an account created under the registry {})", p.registry));
        }

        let listed = Promise::new(p.registry.clone()).function_call(
            "get_agents".to_string(),
            json!({ "from": registry_from, "limit": REGISTRY_PAGE }).to_string().into_bytes(),
            NearToken::from_yoctonear(0),
            GAS_VIEW_REGISTRY,
        );
        let agent = Promise::new(business.clone()).function_call(
            "get_agent".to_string(),
            b"{}".to_vec(),
            NearToken::from_yoctonear(0),
            GAS_VIEW_AGENT,
        );
        listed.and(agent).then(
            Self::ext(env::current_account_id())
                .with_static_gas(GAS_ON_CHECKED)
                .with_unused_gas_weight(1)
                .on_checked(business, amount),
        )
    }

    /// Collects what the vault's note has earned. The business pays it to the
    /// vault. Callable by the agent or the beneficiary, for loans the vault lent to.
    pub fn claim(&mut self, business: AccountId, loan_id: u32) -> Promise {
        self.assert_agent_or_beneficiary();
        self.assert_position(&business, loan_id);
        Promise::new(business.clone())
            .function_call(
                "claim".to_string(),
                json!({ "loan_id": loan_id }).to_string().into_bytes(),
                NearToken::from_yoctonear(0),
                GAS_CLAIM,
            )
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(GAS_ON_CLAIMED)
                    .on_claimed(business, loan_id),
            )
    }

    /// Asks a business the vault lent to to foreclose its open loan. The
    /// business checks that the loan is behind and past its grace period.
    pub fn foreclose(&mut self, business: AccountId, loan_id: u32) -> Promise {
        self.assert_agent_or_beneficiary();
        self.assert_position(&business, loan_id);
        Promise::new(business).function_call(
            "foreclose".to_string(),
            b"{}".to_vec(),
            NearToken::from_yoctonear(0),
            GAS_FORECLOSE,
        )
    }

    /// Pays `amount` to the beneficiary fixed at init, the only account a
    /// withdrawal can go to. Callable by the beneficiary or the agent.
    pub fn withdraw(&mut self, amount: U128) -> Promise {
        self.assert_agent_or_beneficiary();
        require!(amount.0 > 0, "refused: the amount must be positive");
        Promise::new(self.policy.token.clone())
            .function_call(
                "ft_transfer".to_string(),
                json!({ "receiver_id": self.policy.beneficiary, "amount": amount, "memo": "lendvault withdrawal" })
                    .to_string()
                    .into_bytes(),
                ONE_YOCTO,
                GAS_FT_TRANSFER,
            )
            .then(Self::ext(env::current_account_id()).with_static_gas(GAS_ON_WITHDRAWN).on_withdrawn(amount))
    }

    // ---------- callbacks ----------

    /// Checks the two views `lend` asked for, then sends the money. Nothing in
    /// state changes unless every check passes, so a refusal here leaves no trace.
    #[private]
    pub fn on_checked(
        &mut self,
        business: AccountId,
        amount: U128,
        #[callback_result] listed: Result<Vec<AccountId>, PromiseError>,
        #[callback_result] agent: Result<AgentLite, PromiseError>,
    ) -> Promise {
        assert_self();
        let p = self.policy.clone();
        let listed = listed.unwrap_or_else(|_| env::panic_str("refused: the registry did not answer"));
        if !listed.contains(&business) {
            env::panic_str(&format!("refused: {business} is not a Lien business (the registry {} does not list it)", p.registry));
        }
        let agent = agent.unwrap_or_else(|_| env::panic_str(&format!("refused: {business} did not answer get_agent")));
        require!(agent.registry == p.registry, "refused: the business belongs to another registry");
        require!(agent.token == p.token, "refused: the business uses another token");
        let loan = agent
            .current_loan
            .unwrap_or_else(|| env::panic_str(&format!("refused: {business} has no open loan")));
        if loan.status != "Funding" || agent.now >= loan.funding_deadline {
            env::panic_str(&format!("refused: loan {} of {business} is not raising (status {})", loan.id, loan.status));
        }
        let principal = loan.terms.principal.0;
        let needed = principal.saturating_sub(loan.funded.0);
        if amount.0 > needed {
            env::panic_str(&format!("refused: {} is more than the {} the loan still needs", amount.0, needed));
        }
        // Checked again here: other lends may have been sent since `lend` ran.
        if amount.0 > self.budget_left() {
            env::panic_str(&format!("refused: {} is above what is left of total_budget ({})", amount.0, self.budget_left()));
        }
        let key = (business.clone(), loan.id);
        let mut position = self.positions.get(&key).cloned().unwrap_or_default();
        let share_cap = principal * p.max_share_bps as u128 / BPS;
        let after = position.principal.0 + position.in_flight.0 + amount.0;
        if after > share_cap {
            env::panic_str(&format!(
                "refused: the vault's note on loan {} would be {after}, above max_share_bps {} of the principal {principal} ({share_cap})",
                loan.id, p.max_share_bps
            ));
        }

        position.in_flight.0 += amount.0;
        self.positions.insert(key, position);
        self.in_flight += amount.0;
        let msg = json!({ "action": "fund", "loan_id": loan.id }).to_string();
        emit("lend_sent", json!({ "business": business, "loan_id": loan.id, "amount": amount }));
        Promise::new(p.token.clone())
            .function_call(
                "ft_transfer_call".to_string(),
                json!({ "receiver_id": business, "amount": amount, "memo": null, "msg": msg }).to_string().into_bytes(),
                ONE_YOCTO,
                GAS_FT_TRANSFER_CALL,
            )
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(GAS_ON_LENT)
                    .on_lent(business, loan.id, amount),
            )
    }

    /// Settles a lend. The token reports how much the business kept; the rest
    /// came back to the vault. Never panics, so the reservation is always released.
    #[private]
    pub fn on_lent(
        &mut self,
        business: AccountId,
        loan_id: u32,
        amount: U128,
        #[callback_result] used: Result<U128, PromiseError>,
    ) -> U128 {
        assert_self();
        // A failed ft_transfer_call moved nothing.
        let used = used.map(|u| u.0).unwrap_or(0).min(amount.0);
        let refunded = amount.0 - used;
        let key = (business.clone(), loan_id);
        let mut position = self.positions.get(&key).cloned().unwrap_or_default();
        position.in_flight.0 = position.in_flight.0.saturating_sub(amount.0);
        position.principal.0 += used;
        self.in_flight = self.in_flight.saturating_sub(amount.0);
        self.lent += used;
        self.refunded += refunded;
        if position.principal.0 == 0 && position.in_flight.0 == 0 {
            self.positions.remove(&key);
        } else {
            self.positions.insert(key, position);
        }
        if used > 0 {
            self.lends += 1;
        }
        emit("lend_settled", json!({ "business": business, "loan_id": loan_id, "accepted": U128(used), "refunded": U128(refunded) }));
        U128(used)
    }

    #[private]
    pub fn on_claimed(
        &mut self,
        business: AccountId,
        loan_id: u32,
        #[callback_result] amount: Result<U128, PromiseError>,
    ) -> U128 {
        assert_self();
        let amount = amount.map(|a| a.0).unwrap_or(0);
        if amount > 0 {
            let key = (business.clone(), loan_id);
            if let Some(mut position) = self.positions.get(&key).cloned() {
                position.claimed.0 += amount;
                self.positions.insert(key, position);
            }
            self.claimed += amount;
            emit("claimed", json!({ "business": business, "loan_id": loan_id, "amount": U128(amount) }));
        }
        U128(amount)
    }

    #[private]
    pub fn on_withdrawn(&mut self, amount: U128) -> U128 {
        assert_self();
        if !near_sdk::is_promise_success() {
            env::log_str("the withdrawal failed; nothing moved");
            return U128(0);
        }
        self.withdrawn += amount.0;
        emit("withdrawn", json!({ "to": self.policy.beneficiary, "amount": amount }));
        amount
    }
}

impl LendVault {
    fn budget_left(&self) -> u128 {
        self.policy.total_budget.0.saturating_sub(self.lent + self.in_flight)
    }

    fn assert_agent(&self) {
        let caller = env::predecessor_account_id();
        if caller != self.policy.agent {
            env::panic_str(&format!("refused: only the agent {} can lend", self.policy.agent));
        }
    }

    fn assert_agent_or_beneficiary(&self) {
        let caller = env::predecessor_account_id();
        if caller != self.policy.agent && caller != self.policy.beneficiary {
            env::panic_str("refused: only the agent or the beneficiary can do this");
        }
    }

    fn assert_position(&self, business: &AccountId, loan_id: u32) {
        if !self.positions.contains_key(&(business.clone(), loan_id)) {
            env::panic_str(&format!("refused: the vault holds no note on loan {loan_id} of {business}"));
        }
    }
}

/// `#[private]` checks this in the generated wrapper; checking it in the body
/// too keeps it true for every path into the callbacks, including unit tests.
fn assert_self() {
    require!(env::predecessor_account_id() == env::current_account_id(), "refused: callbacks can only be called by the vault itself");
}

/// `label.<registry>`, with no further dots in the label. Businesses are created
/// this way; the registry listing is still the check that counts.
fn is_direct_sub_account(account: &AccountId, parent: &AccountId) -> bool {
    account
        .as_str()
        .strip_suffix(parent.as_str())
        .and_then(|rest| rest.strip_suffix('.'))
        .is_some_and(|label| !label.is_empty() && !label.contains('.'))
}

fn emit(event: &str, data: serde_json::Value) {
    env::log_str(&format!(
        "EVENT_JSON:{}",
        json!({ "standard": "lien-lendvault", "version": "1.0.0", "event": event, "data": [data] })
    ));
}

#[cfg(test)]
mod tests;
