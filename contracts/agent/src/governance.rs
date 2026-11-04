//! Changing a frozen service. While a loan is open the code, price and policy
//! can only change if holders of more than half the principal agree.

use crate::types::*;
use crate::{errors, events, validate, AgentContract, AgentContractExt};
use near_sdk::json_types::U128;
use near_sdk::{env, near, require};

const PROPOSAL_TTL_SECS: u64 = 7 * 24 * 3600;

#[near]
impl AgentContract {
    /// Proposes a new service. The operator can propose on an active loan. In
    /// foreclosure the operator has no say, and any noteholder can propose.
    pub fn propose_change(&mut self, service: Service) -> u32 {
        let loan_id = self.open_loan_id();
        let loan = self.loan(loan_id);
        let caller = env::predecessor_account_id();
        match loan.status {
            LoanStatus::Active => self.assert_operator(),
            LoanStatus::Foreclosed => require!(
                self.notes.contains_key(&(loan_id, caller.clone())),
                errors::NO_NOTE
            ),
            _ => env::panic_str(errors::NOT_ACTIVE),
        }
        let now = self.now();
        require!(
            self.proposal.as_ref().is_none_or(|p| now >= p.expires_at),
            errors::PROPOSAL_OPEN
        );
        validate::service(&service, &self.operator);
        validate::no_wider_policy(&self.service.policy, &service.policy);

        let id = self.next_proposal_id;
        self.next_proposal_id += 1;
        events::proposal_opened(id, loan_id, &service.wasm.hash);
        self.proposal = Some(Proposal {
            id,
            loan_id,
            service,
            proposer: caller,
            expires_at: now + PROPOSAL_TTL_SECS,
            approvals: U128(0),
        });
        id
    }

    /// Votes for the open proposal with this account's whole note. It applies
    /// as soon as more than half of the principal has approved.
    pub fn approve_change(&mut self, proposal_id: u32) {
        let voter = env::predecessor_account_id();
        let now = self.now();
        let mut proposal = self
            .proposal
            .clone()
            .filter(|p| p.id == proposal_id && now < p.expires_at)
            .unwrap_or_else(|| env::panic_str(errors::NO_PROPOSAL));

        let key = (proposal.loan_id, voter);
        let mut note = self.notes.get(&key).cloned().unwrap_or_else(|| env::panic_str(errors::NO_NOTE));
        require!(note.voted_proposal != Some(proposal_id), errors::ALREADY_VOTED);
        note.voted_proposal = Some(proposal_id);
        proposal.approvals.0 += note.principal.0;
        self.notes.insert(key, note);

        let funded = self.loan(proposal.loan_id).funded.0;
        if proposal.approvals.0 * 2 > funded {
            events::proposal_applied(proposal.id, &proposal.service.wasm.hash);
            self.service = proposal.service;
            self.proposal = None;
        } else {
            self.proposal = Some(proposal);
        }
    }
}
