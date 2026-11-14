//! Lendvault v2: a keyless lending vault that will not lend until Sentinel's
//! attested, on-chain verdict on the borrower says it may.
//!
//! Everything v1 (`contracts/lendvault`) does, it still does: the account has
//! no access keys, no owner, no setter and no upgrade method; only the agent
//! fixed at init can lend, with no deposit, so a function-call key is enough;
//! a loan goes only to a business the registry lists, whose loan is raising,
//! within `max_per_loan`, `max_share_bps` of one loan and `total_budget`.
//!
//! What v2 adds:
//!
//! - `hire_check(target)`. The agent asks the vault to buy a Sentinel check.
//!   The vault pays from its own balance with `ft_transfer_call` to the
//!   Sentinel account fixed at init, with the message
//!   `{"action":"job","input":"check <target>"}`. It sends at most
//!   `max_check_price` (Sentinel keeps its price and the token returns the
//!   change), and the total spent on checks can never pass `max_check_spend`.
//!   After paying, it reads Sentinel's newest jobs and records the id of the
//!   job it bought (`get_check`). The transaction's result is that job id.
//!
//! - `lend(business, amount, check_job_id)`. Before any money moves, the vault
//!   reads, in parallel: the registry listing, the business's `get_agent`,
//!   Sentinel's `get_job(check_job_id)` and Sentinel's `get_agent`. It lends
//!   only if the job
//!   1. exists and is `Done`;
//!   2. was paid by this vault (so no one can pass in a job someone else
//!      bought, or one bought with different input);
//!   3. ran Sentinel's currently pinned build (`job.wasm_hash` equals
//!      Sentinel's `service.wasm.hash`), so the verdict is the attested
//!      code's and not an older build's;
//!   4. was created at most `max_check_age_secs` ago (Sentinel records
//!      `created_at` in seconds of block time);
//!   5. has a report whose level is not `high` (BLOCK), and not `medium`
//!      (WARN) unless `allow_warn` was set at init;
//!   6. checked the business's OPERATOR: the input is exactly
//!      `check <operator>` and the report's target is the operator. The
//!      operator is the account that runs the business and draws its share of
//!      revenue; the business account itself is a keyless contract created by
//!      the registry, which the registry listing already vouches for.
//!
//!   The checks run in that order, so a job that fails several is refused for
//!   the first. Each refusal is a panic with a message that starts with
//!   "refused:", and nothing in state changes.
//!
//! What it cannot check: the vault trusts Sentinel's contract to record the
//! payer, input, build hash and report it was given, and trusts the registry
//! to list only businesses it created, exactly as v1 does. A check is a
//! heuristic risk score on the operator's account, not a guarantee.

use near_sdk::json_types::U128;
use near_sdk::serde_json::{self, json};
use near_sdk::store::IterableMap;
use near_sdk::{
    env, near, require, AccountId, BorshStorageKey, Gas, NearToken, PanicOnDefault, Promise, PromiseError,
    PromiseOrValue,
};

/// How many businesses one `get_agents` page returns at most (the registry's own cap).
pub const REGISTRY_PAGE: u32 = 100;
pub const BPS: u128 = 10_000;
/// How many of Sentinel's newest jobs `hire_check` reads to find the one it bought.
pub const JOBS_PAGE: u64 = 20;

const GAS_VIEW_REGISTRY: Gas = Gas::from_tgas(10);
const GAS_VIEW_AGENT: Gas = Gas::from_tgas(15);
const GAS_VIEW_JOB: Gas = Gas::from_tgas(10);
const GAS_VIEW_SENTINEL: Gas = Gas::from_tgas(20);
const GAS_ON_CHECKED: Gas = Gas::from_tgas(115);
const GAS_FT_TRANSFER_CALL: Gas = Gas::from_tgas(80);
const GAS_ON_LENT: Gas = Gas::from_tgas(10);
/// Sentinel's `ft_on_transfer` starts an OutLayer run with 190 Tgas of its own,
/// and the token keeps 30 Tgas for itself.
const GAS_FT_TRANSFER_CALL_JOB: Gas = Gas::from_tgas(235);
const GAS_ON_CHECK_PAID: Gas = Gas::from_tgas(40);
const GAS_VIEW_JOBS: Gas = Gas::from_tgas(12);
const GAS_ON_CHECK_FOUND: Gas = Gas::from_tgas(12);
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
    Checks,
}

/// Fixed at init, forever.
#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq)]
pub struct Policy {
    /// The NEP-141 token the vault holds and lends.
    pub token: AccountId,
    /// The Lien registry. Only businesses it lists can receive a loan.
    pub registry: AccountId,
    /// The Sentinel business whose checks the vault buys and enforces.
    pub sentinel: AccountId,
    /// The only account withdrawals can go to.
    pub beneficiary: AccountId,
    /// The only account that can call `lend` and `hire_check`.
    pub agent: AccountId,
    /// The most one `lend` call can send.
    pub max_per_loan: U128,
    /// The most the vault's note on one loan can be, as a share of that loan's principal.
    pub max_share_bps: u16,
    /// The most the vault can ever lend in total, counting only what businesses accepted.
    pub total_budget: U128,
    /// The most one `hire_check` sends to Sentinel. Sentinel keeps its price; the rest comes back.
    pub max_check_price: U128,
    /// The most the vault can ever spend on checks in total.
    pub max_check_spend: U128,
    /// How old, in seconds, a check can be when it backs a loan.
    pub max_check_age_secs: u64,
    /// Whether a `medium` (WARN) verdict may back a loan. `high` never can.
    pub allow_warn: bool,
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

/// A check the vault bought, as recorded by `hire_check`.
#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq)]
pub struct HiredCheck {
    pub job_id: u64,
    pub target: AccountId,
    pub paid: U128,
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
    /// Paid to Sentinel for checks, lifetime. Counts against `max_check_spend`.
    pub check_spent: U128,
    /// Sent to Sentinel and not settled yet. Also counts against `max_check_spend`.
    pub check_in_flight: U128,
    /// What `max_check_spend` still allows.
    pub check_budget_left: U128,
    pub checks: u32,
}

/// The few fields of a business's `get_agent` the vault reads. Other fields are ignored.
#[near(serializers = [json])]
pub struct AgentLite {
    pub registry: AccountId,
    pub token: AccountId,
    pub operator: AccountId,
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

/// Sentinel's `get_job` answer (contracts/agent `Job`).
#[near(serializers = [json])]
#[derive(Clone)]
pub struct JobLite {
    pub id: u64,
    pub payer: AccountId,
    pub paid: U128,
    pub input: String,
    pub status: String,
    /// A JSON string written by the pinned build: `{target, level, score, flags, ...}`.
    pub report: Option<String>,
    pub created_at: u64,
    pub wasm_hash: String,
}

/// The part of the report the vault reads.
#[near(serializers = [json])]
pub struct ReportLite {
    pub target: String,
    pub level: String,
}

/// The part of Sentinel's `get_agent` the vault reads: the pinned build.
#[near(serializers = [json])]
pub struct SentinelLite {
    pub service: ServiceLite,
}

#[near(serializers = [json])]
pub struct ServiceLite {
    pub wasm: WasmLite,
}

#[near(serializers = [json])]
pub struct WasmLite {
    pub hash: String,
}

#[derive(PanicOnDefault)]
#[near(contract_state)]
pub struct LendVault {
    policy: Policy,
    positions: IterableMap<(AccountId, u32), Position>,
    checks: IterableMap<u64, HiredCheck>,
    lent: u128,
    in_flight: u128,
    refunded: u128,
    claimed: u128,
    withdrawn: u128,
    lends: u32,
    check_spent: u128,
    check_in_flight: u128,
}

#[near]
impl LendVault {
    /// Sets the policy once. There is no method that changes it later.
    #[init]
    pub fn new(policy: Policy) -> Self {
        let p = &policy;
        require!(p.max_per_loan.0 > 0, "max_per_loan must be positive");
        require!(p.total_budget.0 >= p.max_per_loan.0, "total_budget must be at least max_per_loan");
        require!(p.max_share_bps > 0 && p.max_share_bps as u128 <= BPS, "max_share_bps must be between 1 and 10000");
        require!(p.max_check_price.0 > 0, "max_check_price must be positive");
        require!(p.max_check_spend.0 >= p.max_check_price.0, "max_check_spend must be at least max_check_price");
        require!(p.max_check_age_secs > 0, "max_check_age_secs must be positive");
        let me = env::current_account_id();
        require!(p.agent != me && p.beneficiary != me && p.sentinel != me, "the agent, the beneficiary and Sentinel must be other accounts");
        Self {
            policy,
            positions: IterableMap::new(StorageKey::Positions),
            checks: IterableMap::new(StorageKey::Checks),
            lent: 0,
            in_flight: 0,
            refunded: 0,
            claimed: 0,
            withdrawn: 0,
            lends: 0,
            check_spent: 0,
            check_in_flight: 0,
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
            check_spent: U128(self.check_spent),
            check_in_flight: U128(self.check_in_flight),
            check_budget_left: U128(self.check_budget_left()),
            checks: self.checks.len(),
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

    /// A check `hire_check` bought and recorded, by Sentinel job id.
    pub fn get_check(&self, job_id: u64) -> Option<HiredCheck> {
        self.checks.get(&job_id).cloned()
    }

    pub fn get_checks(&self, from: Option<u32>, limit: Option<u32>) -> Vec<HiredCheck> {
        self.checks
            .values()
            .skip(from.unwrap_or(0) as usize)
            .take(limit.unwrap_or(50).min(100) as usize)
            .cloned()
            .collect()
    }

    // ---------- the agent's calls ----------

    /// Buys one Sentinel check on `target`, paid from the vault's balance. Only
    /// the agent can call it, with no deposit. Attach 300 Tgas. The
    /// transaction's result is the Sentinel job id (or null if the payment
    /// bounced); the verdict lands on chain when OutLayer returns, usually
    /// within a minute, and is read with Sentinel's `get_job`.
    pub fn hire_check(&mut self, target: AccountId) -> Promise {
        require!(env::attached_deposit().is_zero(), "refused: hire_check takes no deposit");
        self.assert_agent();
        let price = self.policy.max_check_price.0;
        if price > self.check_budget_left() {
            env::panic_str(&format!(
                "refused: a check of up to {price} is above what is left of max_check_spend ({})",
                self.check_budget_left()
            ));
        }
        self.check_in_flight += price;
        let msg = json!({ "action": "job", "input": check_input(&target) }).to_string();
        emit("check_sent", json!({ "sentinel": self.policy.sentinel, "target": target, "amount": U128(price) }));
        Promise::new(self.policy.token.clone())
            .function_call_weight(
                "ft_transfer_call".to_string(),
                json!({ "receiver_id": self.policy.sentinel, "amount": U128(price), "memo": null, "msg": msg })
                    .to_string()
                    .into_bytes(),
                ONE_YOCTO,
                GAS_FT_TRANSFER_CALL_JOB,
                near_sdk::GasWeight(1),
            )
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(GAS_ON_CHECK_PAID)
                    .with_unused_gas_weight(0)
                    .on_check_paid(target, U128(price)),
            )
    }

    /// Lends `amount` of the vault's tokens to `business`'s loan that is raising,
    /// if Sentinel job `check_job_id` is a recent, passing check on the
    /// business's operator that this vault paid for. Only the agent can call
    /// it, with no deposit, so a function-call key works. Attach 300 Tgas.
    /// `registry_from` is passed to the registry's `get_agents` as `from`.
    /// The transaction's result is the amount the business accepted.
    pub fn lend(&mut self, business: AccountId, amount: U128, check_job_id: u64, registry_from: Option<u32>) -> Promise {
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

        let view = |account: &AccountId, method: &str, args: serde_json::Value, gas: Gas| {
            Promise::new(account.clone()).function_call(
                method.to_string(),
                args.to_string().into_bytes(),
                NearToken::from_yoctonear(0),
                gas,
            )
        };
        let listed = view(&p.registry, "get_agents", json!({ "from": registry_from, "limit": REGISTRY_PAGE }), GAS_VIEW_REGISTRY);
        let agent = view(&business, "get_agent", json!({}), GAS_VIEW_AGENT);
        let job = view(&p.sentinel, "get_job", json!({ "job_id": check_job_id }), GAS_VIEW_JOB);
        let sentinel = view(&p.sentinel, "get_agent", json!({}), GAS_VIEW_SENTINEL);
        listed.and(agent).and(job).and(sentinel).then(
            Self::ext(env::current_account_id())
                .with_static_gas(GAS_ON_CHECKED)
                .with_unused_gas_weight(1)
                .on_checked(business, amount, check_job_id),
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

    /// Settles a check payment. The token reports what Sentinel kept (its
    /// price); the change came back. If Sentinel kept something, reads its
    /// newest jobs to record the one bought. Never panics.
    #[private]
    pub fn on_check_paid(
        &mut self,
        target: AccountId,
        sent: U128,
        #[callback_result] used: Result<U128, PromiseError>,
    ) -> PromiseOrValue<Option<u64>> {
        assert_self();
        let used = used.map(|u| u.0).unwrap_or(0).min(sent.0);
        self.check_in_flight = self.check_in_flight.saturating_sub(sent.0);
        self.check_spent += used;
        emit("check_settled", json!({ "target": target, "paid": U128(used), "returned": U128(sent.0 - used) }));
        if used == 0 {
            env::log_str("the check was not bought; nothing was spent");
            return PromiseOrValue::Value(None);
        }
        PromiseOrValue::Promise(
            Promise::new(self.policy.sentinel.clone())
                .function_call(
                    "get_jobs".to_string(),
                    json!({ "limit": JOBS_PAGE }).to_string().into_bytes(),
                    NearToken::from_yoctonear(0),
                    GAS_VIEW_JOBS,
                )
                .then(
                    Self::ext(env::current_account_id())
                        .with_static_gas(GAS_ON_CHECK_FOUND)
                        .on_check_found(target, U128(used)),
                ),
        )
    }

    /// Records the job the vault just bought: the newest job paid by this vault
    /// with the expected input that is not recorded yet. Never panics; `lend`
    /// does not depend on this record (it checks the payer on Sentinel itself).
    #[private]
    pub fn on_check_found(
        &mut self,
        target: AccountId,
        paid: U128,
        #[callback_result] jobs: Result<Vec<JobLite>, PromiseError>,
    ) -> Option<u64> {
        assert_self();
        let me = env::current_account_id();
        let input = check_input(&target);
        let found = jobs
            .unwrap_or_default()
            .into_iter()
            .find(|j| j.payer == me && j.input == input && !self.checks.contains_key(&j.id));
        match found {
            Some(job) => {
                self.checks.insert(job.id, HiredCheck { job_id: job.id, target: target.clone(), paid });
                emit("check_hired", json!({ "job_id": job.id, "target": target, "paid": paid }));
                Some(job.id)
            }
            None => {
                env::log_str("paid for a check but could not find its job among Sentinel's newest; read Sentinel's get_jobs");
                None
            }
        }
    }

    /// Checks the four views `lend` asked for, then sends the money. Nothing in
    /// state changes unless every check passes, so a refusal leaves no trace.
    #[private]
    #[allow(clippy::too_many_arguments)]
    pub fn on_checked(
        &mut self,
        business: AccountId,
        amount: U128,
        check_job_id: u64,
        #[callback_result] listed: Result<Vec<AccountId>, PromiseError>,
        #[callback_result] agent: Result<AgentLite, PromiseError>,
        #[callback_result] job: Result<Option<JobLite>, PromiseError>,
        #[callback_result] sentinel: Result<SentinelLite, PromiseError>,
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
            .as_ref()
            .unwrap_or_else(|| env::panic_str(&format!("refused: {business} has no open loan")));
        if loan.status != "Funding" || agent.now >= loan.funding_deadline {
            env::panic_str(&format!("refused: loan {} of {business} is not raising (status {})", loan.id, loan.status));
        }

        self.assert_verdict(check_job_id, &agent.operator, job, sentinel);

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

        let loan_id = loan.id;
        position.in_flight.0 += amount.0;
        self.positions.insert(key, position);
        self.in_flight += amount.0;
        let msg = json!({ "action": "fund", "loan_id": loan_id }).to_string();
        emit(
            "lend_sent",
            json!({ "business": business, "loan_id": loan_id, "amount": amount, "check_job_id": check_job_id, "operator": agent.operator }),
        );
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
                    .on_lent(business, loan_id, amount),
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

    fn check_budget_left(&self) -> u128 {
        self.policy.max_check_spend.0.saturating_sub(self.check_spent + self.check_in_flight)
    }

    /// Sentinel's verdict on `operator`, as job `job_id` recorded it. Panics with
    /// a "refused:" message unless the job is a recent, passing check on the
    /// operator, bought by this vault and run by Sentinel's pinned build.
    fn assert_verdict(
        &self,
        job_id: u64,
        operator: &AccountId,
        job: Result<Option<JobLite>, PromiseError>,
        sentinel: Result<SentinelLite, PromiseError>,
    ) {
        let p = &self.policy;
        let job = job
            .unwrap_or_else(|_| env::panic_str(&format!("refused: Sentinel {} did not answer get_job", p.sentinel)))
            .unwrap_or_else(|| env::panic_str(&format!("refused: Sentinel has no job {job_id}")));
        require!(job.id == job_id, "refused: Sentinel answered with another job");
        if job.status != "Done" {
            env::panic_str(&format!("refused: check {job_id} is not Done (status {})", job.status));
        }
        let me = env::current_account_id();
        if job.payer != me {
            env::panic_str(&format!("refused: check {job_id} was paid by {}, not by this vault", job.payer));
        }
        let sentinel = sentinel.unwrap_or_else(|_| env::panic_str(&format!("refused: Sentinel {} did not answer get_agent", p.sentinel)));
        if job.wasm_hash != sentinel.service.wasm.hash {
            env::panic_str(&format!(
                "refused: check {job_id} ran build {}, not Sentinel's pinned build {}",
                job.wasm_hash, sentinel.service.wasm.hash
            ));
        }
        let age = (env::block_timestamp() / 1_000_000_000).saturating_sub(job.created_at);
        if age > p.max_check_age_secs {
            env::panic_str(&format!("refused: check {job_id} is {age} seconds old, above max_check_age_secs {}", p.max_check_age_secs));
        }
        let report: ReportLite = job
            .report
            .as_deref()
            .and_then(|r| serde_json::from_str(r).ok())
            .unwrap_or_else(|| env::panic_str(&format!("refused: check {job_id} has no readable report")));
        match report.level.as_str() {
            "low" => {}
            "medium" if p.allow_warn => {}
            "medium" => env::panic_str(&format!(
                "refused: check {job_id} on {} is medium risk (WARN), and this vault lends only on low",
                report.target
            )),
            "high" => env::panic_str(&format!("refused: check {job_id} on {} is high risk (BLOCK)", report.target)),
            other => env::panic_str(&format!("refused: check {job_id} has an unknown level {other}")),
        }
        if job.input != check_input(operator) || report.target != operator.as_str() {
            env::panic_str(&format!(
                "refused: check {job_id} is on {}, not on the business's operator {operator}",
                report.target
            ));
        }
    }

    fn assert_agent(&self) {
        let caller = env::predecessor_account_id();
        if caller != self.policy.agent {
            env::panic_str(&format!("refused: only the agent {} can do this", self.policy.agent));
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

/// The exact input `hire_check` sends and `lend` expects.
pub fn check_input(target: &AccountId) -> String {
    format!("check {target}")
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
        json!({ "standard": "lien-lendvault", "version": "2.0.0", "event": event, "data": [data] })
    ));
}

#[cfg(test)]
mod tests;
