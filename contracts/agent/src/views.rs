//! Read-only state for the app, lenders and anyone auditing the business.

use crate::math::min_bid;
use crate::types::*;
use crate::{AgentContract, AgentContractExt};
use near_sdk::json_types::U128;
use near_sdk::{near, AccountId, NearToken};

#[near(serializers = [json])]
pub struct LoanView {
    #[serde(flatten)]
    pub loan: Loan,
    pub outstanding: U128,
    pub is_behind: bool,
    pub breach_at: Option<u64>,
    pub foreclosable_at: Option<u64>,
    pub maturity: Option<u64>,
    pub min_next_bid: Option<U128>,
}

#[near(serializers = [json])]
pub struct AgentView {
    pub name: String,
    pub description: String,
    pub source_url: String,
    pub registry: AccountId,
    pub token: AccountId,
    pub outlayer: AccountId,
    pub collector: AccountId,
    pub operator: AccountId,
    pub service: Service,
    pub ledger: Ledger,
    pub stats: Stats,
    pub tank: NearToken,
    pub loan_count: u32,
    pub current_loan: Option<LoanView>,
    pub proposal: Option<Proposal>,
    pub next_job_id: u64,
    pub pending_jobs: u32,
    pub spent_today: U128,
    pub now: u64,
}

#[near(serializers = [json])]
pub struct NoteView {
    #[serde(flatten)]
    pub note: Note,
    pub claimable: U128,
}

#[near]
impl AgentContract {
    pub fn get_agent(&self) -> AgentView {
        let now = self.now();
        let spent_today = if now / 86_400 == self.spend_day { self.spent_today } else { 0 };
        AgentView {
            name: self.name.clone(),
            description: self.description.clone(),
            source_url: self.source_url.clone(),
            registry: self.registry.clone(),
            token: self.token.clone(),
            outlayer: self.outlayer.clone(),
            collector: self.collector.clone(),
            operator: self.operator.clone(),
            service: self.service.clone(),
            ledger: self.ledger.clone(),
            stats: self.stats.clone(),
            tank: self.tank(),
            loan_count: self.loans.len(),
            current_loan: self.current_loan.map(|id| self.loan_view(id)),
            proposal: self.proposal.clone(),
            next_job_id: self.next_job_id,
            pending_jobs: self.pending_jobs,
            spent_today: U128(spent_today),
            now,
        }
    }

    pub fn get_loan(&self, loan_id: u32) -> Option<LoanView> {
        (loan_id < self.loans.len()).then(|| self.loan_view(loan_id))
    }

    /// Loans, newest first.
    pub fn get_loans(&self, from: Option<u32>, limit: Option<u32>) -> Vec<LoanView> {
        let count = self.loans.len();
        let start = from.unwrap_or(count).min(count);
        let limit = limit.unwrap_or(20).min(50);
        (0..start).rev().take(limit as usize).map(|id| self.loan_view(id)).collect()
    }

    pub fn get_note(&self, loan_id: u32, account_id: AccountId) -> Option<NoteView> {
        self.notes.get(&(loan_id, account_id.clone())).cloned().map(|note| NoteView {
            note,
            claimable: U128(self.claimable_on(loan_id, &account_id)),
        })
    }

    pub fn get_job(&self, job_id: u64) -> Option<Job> {
        self.jobs.get(&job_id).cloned()
    }

    /// Jobs, newest first. Only the most recent 200 are kept.
    pub fn get_jobs(&self, from: Option<u64>, limit: Option<u64>) -> Vec<Job> {
        let start = from.unwrap_or(self.next_job_id).min(self.next_job_id);
        let limit = limit.unwrap_or(20).min(50);
        (0..start)
            .rev()
            .take(limit as usize)
            .filter_map(|id| self.jobs.get(&id).cloned())
            .collect()
    }

    pub fn get_credit(&self, account_id: AccountId) -> U128 {
        U128(self.credits.get(&account_id).copied().unwrap_or(0))
    }
}

impl AgentContract {
    fn loan_view(&self, id: u32) -> LoanView {
        let loan = self.loan(id);
        let outstanding = loan.terms.total_due.0.saturating_sub(loan.repaid.0);
        let open = matches!(loan.status, LoanStatus::Active | LoanStatus::Foreclosed);
        let schedule = loan.activated_at.filter(|_| open).map(|_| Self::schedule(&loan));
        let breach_at = schedule.and_then(|s| s.breach_time(loan.repaid.0));
        let min_next_bid = (loan.status == LoanStatus::Foreclosed).then(|| {
            U128(min_bid(outstanding, loan.terms.auction_reserve_bps, loan.auction.high_bid.0))
        });
        LoanView {
            is_behind: schedule.is_some_and(|s| s.is_behind(loan.repaid.0, self.now())),
            foreclosable_at: breach_at.map(|at| at.saturating_add(loan.terms.grace_secs)),
            maturity: schedule.map(|s| s.maturity()),
            breach_at,
            outstanding: U128(outstanding),
            min_next_bid,
            loan,
        }
    }
}
