//! Selling work. A customer's payment is held until the pinned code has run.
//! It only becomes revenue on success, otherwise it goes back to them.

use crate::types::*;
use crate::{errors, events, AgentContract, AgentContractExt};
use near_sdk::json_types::U128;
use near_sdk::serde::Deserialize;
use near_sdk::serde_json::{self, json, Value};
use near_sdk::{env, ext_contract, near, require, AccountId, Gas, NearToken, PromiseError};

const MAX_INPUT: usize = 2_048;
/// OutLayer resumes a yield with at most 1024 bytes in its direct path.
pub const MAX_REPORT: usize = 1_024;
const MAX_PENDING: u32 = 64;
const MAX_SPENDS: usize = 3;
/// Finished jobs older than this many ids are dropped to keep storage bounded.
const KEEP_JOBS: u64 = 200;
/// A job still pending after this long can be refunded by anyone. OutLayer's
/// yield times out long before this, so this only covers a lost callback.
const JOB_TTL_SECS: u64 = 3_600;
const SECONDS_PER_DAY: u64 = 86_400;

/// Must leave room for OutLayer's 50 TGas settlement callback.
const GAS_OUTLAYER: Gas = Gas::from_tgas(120);
const GAS_ON_JOB: Gas = Gas::from_tgas(70);
const GAS_STORE_SECRETS: Gas = Gas::from_tgas(50);
/// NEAR kept back so storage writes never run the account dry.
const TANK_RESERVE: NearToken = NearToken::from_millinear(50);

#[ext_contract(ext_outlayer)]
#[allow(dead_code)]
trait OutLayer {
    #[allow(clippy::too_many_arguments)]
    fn request_execution(
        &mut self,
        source: Value,
        resource_limits: Option<Value>,
        input_data: Option<String>,
        secrets_ref: Option<Value>,
        response_format: Option<String>,
        payer_account_id: Option<AccountId>,
        params: Option<Value>,
    );

    fn store_secrets(
        &mut self,
        accessor: Value,
        profile: String,
        encrypted_secrets_base64: String,
        access: Value,
        vault_id: Option<AccountId>,
    );
}

/// What the pinned code prints to stdout.
#[derive(Deserialize)]
#[serde(crate = "near_sdk::serde")]
struct GuestOutput {
    ok: bool,
    #[serde(default)]
    report: Option<Value>,
    #[serde(default)]
    spends: Vec<GuestSpend>,
}

#[derive(Deserialize)]
#[serde(crate = "near_sdk::serde")]
struct GuestSpend {
    to: String,
    amount: U128,
}

#[near]
impl AgentContract {
    /// Pays NEAR into the tank that funds the agent's compute and storage.
    #[payable]
    pub fn fund_tank(&mut self) {}

    /// Takes spare NEAR back out. Only possible with no open loan.
    pub fn withdraw_tank(&mut self, amount: NearToken) {
        self.assert_operator();
        self.assert_no_open_loan();
        require!(amount <= self.tank(), errors::INSUFFICIENT);
        near_sdk::Promise::new(self.operator.clone()).transfer(amount).detach();
    }

    /// Stores encrypted secrets for the agent's code, such as a NEAR AI key. The
    /// row belongs to this account rather than the operator, so it passes with the
    /// business. Only possible with no open loan, since it changes what the frozen
    /// code can do. The attached NEAR pays OutLayer's storage cost.
    #[payable]
    pub fn store_secrets(
        &mut self,
        accessor: Value,
        profile: String,
        encrypted_secrets_base64: String,
        access: Value,
    ) -> near_sdk::Promise {
        self.assert_operator();
        self.assert_no_open_loan();
        ext_outlayer::ext(self.outlayer.clone())
            .with_attached_deposit(env::attached_deposit())
            .with_static_gas(GAS_STORE_SECRETS)
            .store_secrets(accessor, profile, encrypted_secrets_base64, access, None)
    }

    /// Settles a job when OutLayer returns. This never panics: if it did, the
    /// customer's money would sit in escrow until the job expired.
    #[private]
    pub fn on_job_result(
        &mut self,
        job_id: u64,
        #[callback_result] result: Result<Option<Value>, PromiseError>,
    ) {
        let Some(job) = self.jobs.get(&job_id).cloned().filter(|j| j.status == JobStatus::Pending) else {
            return;
        };
        match Self::parse_output(result) {
            Ok(output) => self.finish_job(job, output),
            Err(reason) => self.refund_job(job, reason),
        }
    }

    /// Refunds a job whose result never arrived.
    pub fn expire_job(&mut self, job_id: u64) {
        let job = self.jobs.get(&job_id).cloned().unwrap_or_else(|| env::panic_str("unknown job"));
        require!(job.status == JobStatus::Pending, errors::NOT_PENDING);
        require!(self.now() >= job.created_at + JOB_TTL_SECS, errors::TOO_EARLY);
        self.refund_job(job, "expired");
    }
}

impl AgentContract {
    /// NEAR free to spend, above what storage requires.
    pub(crate) fn tank(&self) -> NearToken {
        let storage = env::storage_byte_cost().saturating_mul(env::storage_usage() as u128);
        env::account_balance()
            .saturating_sub(storage)
            .saturating_sub(TANK_RESERVE)
    }

    /// Takes a customer's payment and starts the pinned code. Returns the part
    /// of the payment above the price.
    pub(crate) fn start_job(&mut self, payer: AccountId, amount: u128, input: String) -> u128 {
        let price = self.service.price.0;
        require!(amount >= price, "payment is below the price of a job");
        require!(input.len() <= MAX_INPUT, "input is above 2048 bytes");
        require!(self.pending_jobs < MAX_PENDING, "too many jobs in progress; try again shortly");
        require!(
            self.tank() >= self.service.compute_deposit,
            "the agent is out of compute funds; nothing was charged"
        );

        let id = self.next_job_id;
        self.next_job_id += 1;
        self.pending_jobs += 1;
        self.ledger.job_escrow.0 += price;
        if self.payers.insert(payer.clone()) {
            self.stats.unique_payers += 1;
        }

        let stdin = json!({ "job_id": id, "payer": payer, "input": input }).to_string();
        self.jobs.insert(
            id,
            Job {
                id,
                payer: payer.clone(),
                paid: U128(price),
                input,
                status: JobStatus::Pending,
                report: None,
                created_at: self.now(),
                wasm_hash: self.service.wasm.hash.clone(),
            },
        );
        self.evict_old_job(id);
        self.dispatch(id, stdin);
        events::job_started(id, &payer, price);
        amount - price
    }

    fn dispatch(&self, job_id: u64, stdin: String) {
        let service = &self.service;
        let source = json!({ "WasmUrl": {
            "url": service.wasm.url,
            "hash": service.wasm.hash,
            "build_target": service.wasm.build_target,
        }});
        let limits = json!({
            "max_instructions": service.max_instructions,
            "max_memory_mb": service.max_memory_mb,
            "max_execution_seconds": service.max_execution_seconds,
        });
        let secrets = service
            .secrets_profile
            .as_ref()
            .map(|profile| json!({ "profile": profile, "account_id": env::current_account_id() }));
        // Not returned to the token: the customer's transfer is final here, and
        // settlement happens in `on_job_result`.
        ext_outlayer::ext(self.outlayer.clone())
            .with_attached_deposit(service.compute_deposit)
            .with_static_gas(GAS_OUTLAYER)
            .request_execution(
                source,
                Some(limits),
                Some(stdin),
                secrets,
                Some("Json".to_string()),
                None,
                None,
            )
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(GAS_ON_JOB)
                    .on_job_result(job_id),
            )
            .detach();
    }

    fn parse_output(result: Result<Option<Value>, PromiseError>) -> Result<GuestOutput, &'static str> {
        let value = match result {
            Ok(Some(value)) => value,
            Ok(None) => return Err("no_output"),
            Err(_) => return Err("execution_failed"),
        };
        let output: GuestOutput = serde_json::from_value(value).map_err(|_| "malformed_output")?;
        if !output.ok {
            return Err("agent_declined");
        }
        Ok(output)
    }

    fn finish_job(&mut self, mut job: Job, output: GuestOutput) {
        let report = output.report.map(|r| r.to_string());
        if report.as_ref().is_some_and(|r| r.len() > MAX_REPORT) {
            return self.refund_job(job, "report_too_large");
        }
        let paid = job.paid.0;
        self.ledger.job_escrow.0 -= paid;
        self.pending_jobs -= 1;
        self.stats.jobs_done += 1;
        self.stats.job_revenue.0 += paid;
        job.status = JobStatus::Done;
        job.report = report;
        let id = job.id;
        self.jobs.insert(id, job);
        // Revenue first, so a spend can never reach into what lenders are owed.
        self.recognize_revenue(paid, "job");
        for spend in output.spends.into_iter().take(MAX_SPENDS) {
            self.try_spend(id, spend);
        }
        events::job_done(id);
    }

    fn refund_job(&mut self, mut job: Job, reason: &str) {
        let paid = job.paid.0;
        self.ledger.job_escrow.0 -= paid;
        self.pending_jobs -= 1;
        self.stats.jobs_refunded += 1;
        job.status = JobStatus::Refunded;
        let (id, payer) = (job.id, job.payer.clone());
        self.jobs.insert(id, job);
        self.credit(&payer, paid);
        self.push(&payer);
        events::job_refunded(id, reason);
    }

    /// A spend the policy refuses is logged and skipped. It does not fail the
    /// job, because the customer has already received what they paid for.
    fn try_spend(&mut self, job_id: u64, spend: GuestSpend) {
        let amount = spend.amount.0;
        let block = |contract: &mut Self, reason: &str| {
            contract.stats.spends_blocked += 1;
            events::spend_blocked(job_id, &spend.to, amount, reason);
        };
        let Ok(to) = spend.to.parse::<AccountId>() else {
            return block(self, "invalid_account");
        };
        let policy = &self.service.policy;
        if !policy.vendors.contains(&to) {
            return block(self, "not_a_vendor");
        }
        if amount == 0 || amount > policy.max_per_tx.0 {
            return block(self, "over_tx_limit");
        }
        let day = self.now() / SECONDS_PER_DAY;
        let spent_today = if day == self.spend_day { self.spent_today } else { 0 };
        if spent_today + amount > policy.max_per_day.0 {
            return block(self, "over_daily_limit");
        }
        if amount > self.ledger.opex.0 {
            return block(self, "insufficient_opex");
        }
        self.spend_day = day;
        self.spent_today = spent_today + amount;
        self.ledger.opex.0 -= amount;
        self.stats.spent.0 += amount;
        self.credit(&to, amount);
        self.push(&to);
        events::spent(job_id, &to, amount);
    }

    fn evict_old_job(&mut self, newest: u64) {
        let Some(old) = newest.checked_sub(KEEP_JOBS) else { return };
        if self.jobs.get(&old).is_some_and(|j| j.status != JobStatus::Pending) {
            self.jobs.remove(&old);
        }
    }
}
