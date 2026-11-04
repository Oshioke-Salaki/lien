//! Lender positions: claiming repayments and moving a note to someone else.

use crate::math::claimable;
use crate::{errors, AgentContract, AgentContractExt};
use near_sdk::json_types::U128;
use near_sdk::{assert_one_yocto, env, near, require, AccountId};

#[near]
impl AgentContract {
    /// Pays out everything this note has earned so far on a loan. Works in any
    /// status, including after the loan closes.
    pub fn claim(&mut self, loan_id: u32) -> U128 {
        let lender = env::predecessor_account_id();
        let amount = self.claimable_on(loan_id, &lender);
        require!(amount > 0, errors::NOTHING_TO_CLAIM);
        let key = (loan_id, lender.clone());
        let mut note = self.notes.get(&key).cloned().unwrap_or_else(|| env::panic_str(errors::NO_NOTE));
        note.claimed.0 += amount;
        self.notes.insert(key, note);
        self.ledger.lender_pool.0 -= amount;
        self.credit(&lender, amount);
        self.push(&lender);
        U128(amount)
    }

    /// Moves a whole note to another account, along with what it already
    /// claimed. Requires a full-access key, like any transfer of value.
    #[payable]
    pub fn transfer_note(&mut self, loan_id: u32, to: AccountId) {
        assert_one_yocto();
        let from = env::predecessor_account_id();
        require!(from != to, "cannot transfer a note to yourself");
        let from_key = (loan_id, from);
        let note = self.notes.get(&from_key).cloned().unwrap_or_else(|| env::panic_str(errors::NO_NOTE));
        let open_proposal = self.proposal.as_ref().map(|p| p.id);
        require!(
            note.voted_proposal.is_none() || note.voted_proposal != open_proposal,
            errors::VOTE_LOCK
        );

        let to_key = (loan_id, to);
        let existing = self.notes.get(&to_key).cloned();
        if let Some(existing) = &existing {
            require!(
                existing.voted_proposal.is_none() || existing.voted_proposal != open_proposal,
                errors::VOTE_LOCK
            );
        }
        let is_new = existing.is_none();
        let mut merged = existing.unwrap_or_default();
        merged.principal.0 += note.principal.0;
        merged.claimed.0 += note.claimed.0;
        self.notes.insert(to_key, merged);
        self.notes.remove(&from_key);
        if !is_new {
            self.loan_mut(loan_id).holders -= 1;
        }
    }
}

impl AgentContract {
    pub(crate) fn claimable_on(&self, loan_id: u32, lender: &AccountId) -> u128 {
        let Some(note) = self.notes.get(&(loan_id, lender.clone())) else { return 0 };
        let loan = self.loan(loan_id);
        claimable(loan.repaid.0, note.principal.0, loan.funded.0, note.claimed.0)
    }
}
