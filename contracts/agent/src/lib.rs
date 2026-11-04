//! A self-owning AI business.
//!
//! This account holds no access keys. It pins the exact WebAssembly build the
//! business runs, sells jobs, routes every inflow through a waterfall, borrows
//! from lenders, and hands itself to them if it stops paying. Nobody can spend
//! its money directly: spending only happens when the pinned code asks and the
//! policy agrees.

use near_sdk::store::{LookupMap, LookupSet, Vector};
use near_sdk::{env, near, require, AccountId, BorshStorageKey, PanicOnDefault};

mod auction;
mod errors;
mod events;
mod governance;
mod jobs;
mod loan;
pub mod math;
mod notes;
mod payouts;
mod receiver;
#[cfg(test)]
mod tests;
pub mod types;
mod validate;
mod views;

use types::*;

#[derive(BorshStorageKey)]
#[near]
enum StorageKey {
    Loans,
    Notes,
    Credits,
    Payers,
    Jobs,
}

#[derive(PanicOnDefault)]
#[near(contract_state)]
pub struct AgentContract {
    pub(crate) registry: AccountId,
    pub(crate) token: AccountId,
    pub(crate) outlayer: AccountId,
    pub(crate) collector: AccountId,
    pub(crate) name: String,
    pub(crate) description: String,
    pub(crate) source_url: String,

    pub(crate) operator: AccountId,
    pub(crate) service: Service,

    pub(crate) ledger: Ledger,
    pub(crate) stats: Stats,

    pub(crate) loans: Vector<Loan>,
    pub(crate) current_loan: Option<u32>,
    pub(crate) notes: LookupMap<(u32, AccountId), Note>,
    pub(crate) credits: LookupMap<AccountId, u128>,
    pub(crate) payers: LookupSet<AccountId>,

    pub(crate) jobs: LookupMap<u64, Job>,
    pub(crate) next_job_id: u64,
    pub(crate) pending_jobs: u32,

    pub(crate) proposal: Option<Proposal>,
    pub(crate) next_proposal_id: u32,

    pub(crate) spend_day: u64,
    pub(crate) spent_today: u128,
}

#[near]
impl AgentContract {
    #[init]
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        token: AccountId,
        outlayer: AccountId,
        collector: AccountId,
        operator: AccountId,
        name: String,
        description: String,
        source_url: String,
        service: Service,
    ) -> Self {
        validate::text(&name, 1, 64, "name");
        validate::text(&description, 0, 512, "description");
        validate::text(&source_url, 0, 256, "source_url");
        validate::service(&service, &operator);
        Self {
            registry: env::predecessor_account_id(),
            token,
            outlayer,
            collector,
            name,
            description,
            source_url,
            operator,
            service,
            ledger: Ledger::default(),
            stats: Stats::default(),
            loans: Vector::new(StorageKey::Loans),
            current_loan: None,
            notes: LookupMap::new(StorageKey::Notes),
            credits: LookupMap::new(StorageKey::Credits),
            payers: LookupSet::new(StorageKey::Payers),
            jobs: LookupMap::new(StorageKey::Jobs),
            next_job_id: 0,
            pending_jobs: 0,
            proposal: None,
            next_proposal_id: 0,
            spend_day: 0,
            spent_today: 0,
        }
    }
}

impl AgentContract {
    pub(crate) fn now(&self) -> u64 {
        env::block_timestamp() / 1_000_000_000
    }

    pub(crate) fn assert_operator(&self) {
        require!(env::predecessor_account_id() == self.operator, errors::NOT_OPERATOR);
    }

    pub(crate) fn assert_no_open_loan(&self) {
        require!(self.current_loan.is_none(), errors::LOAN_OPEN);
    }
}
