//! A loan's life: offer, funding, repayment and foreclosure.

use crate::math::{split_inflow, Schedule, MAX_AMOUNT};
use crate::types::*;
use crate::{errors, events, validate, AgentContract, AgentContractExt};
use near_sdk::json_types::U128;
use near_sdk::{env, near, require, AccountId};

/// Bounds the storage a loan can force this contract to pay for.
pub const MAX_NOTES: u32 = 50;
/// Smallest note, as a fraction of principal, so 50 holders can always fill it.
const MIN_NOTE_DIVISOR: u128 = 50;
/// On foreclosure the business keeps this many days of allowed spending to stay
/// running. Working capital above that goes straight to lenders.
const OPEX_RUNWAY_DAYS: u128 = 7;

#[near]
impl AgentContract {
    /// Opens a loan offer. From here until the loan closes the service is
    /// frozen, because this is what lenders are underwriting.
    pub fn create_offer(&mut self, terms: LoanTerms) -> u32 {
        self.assert_operator();
        self.assert_no_open_loan();
        validate::terms(&terms);
        let now = self.now();
        let id = self.loans.len();
        let (principal, total_due) = (terms.principal, terms.total_due);
        self.loans.push(Loan {
            id,
            funding_deadline: now + terms.funding_secs,
            terms,
            status: LoanStatus::Funding,
            created_at: now,
            activated_at: None,
            funded: U128(0),
            repaid: U128(0),
            holders: 0,
            foreclosed_at: None,
            closed_at: None,
            auction: Auction::default(),
        });
        self.current_loan = Some(id);
        events::offer_created(id, principal, total_due);
        id
    }

    /// Ends an unfilled offer and lets lenders claim their money back. The
    /// operator can do this at any time, anyone can once the deadline passes.
    pub fn cancel_offer(&mut self) {
        let id = self.open_loan_id();
        let loan = self.loan(id);
        require!(loan.status == LoanStatus::Funding, errors::NOT_FUNDING);
        let expired = self.now() >= loan.funding_deadline;
        require!(
            expired || env::predecessor_account_id() == self.operator,
            "only the operator can cancel before the funding deadline"
        );
        let funded = loan.funded.0;
        self.ledger.funding_escrow.0 -= funded;
        self.ledger.lender_pool.0 += funded;
        let now = self.now();
        let loan = self.loan_mut(id);
        // Treating the refund as a repayment lets notes claim through one path.
        loan.repaid = U128(funded);
        loan.status = LoanStatus::Cancelled;
        loan.closed_at = Some(now);
        self.current_loan = None;
        events::cancelled(id);
    }

    /// Takes over the business once the borrower is behind and the grace period
    /// has run out. Anyone can call this, so lenders never depend on a keeper.
    pub fn foreclose(&mut self) {
        let id = self.open_loan_id();
        let loan = self.loan(id);
        require!(loan.status == LoanStatus::Active, errors::NOT_ACTIVE);
        let schedule = Self::schedule(&loan);
        let now = self.now();
        require!(
            schedule.can_foreclose(loan.repaid.0, now, loan.terms.grace_secs),
            errors::STILL_IN_GRACE
        );

        let outstanding = loan.terms.total_due.0 - loan.repaid.0;
        let from_operator = self.ledger.operator.0.min(outstanding);
        self.ledger.operator.0 -= from_operator;
        let runway = self.service.policy.max_per_day.0.saturating_mul(OPEX_RUNWAY_DAYS);
        let idle_opex = self.ledger.opex.0.saturating_sub(runway);
        let from_opex = idle_opex.min(outstanding - from_operator);
        self.ledger.opex.0 -= from_opex;
        let seized = from_operator + from_opex;
        self.pay_lenders(id, seized);

        let by = env::predecessor_account_id();
        let loan = self.loan_mut(id);
        loan.foreclosed_at = Some(now);
        loan.status = LoanStatus::Foreclosed;
        let remaining = loan.terms.total_due.0 - loan.repaid.0;
        self.proposal = None;
        events::foreclosed(id, &by, remaining, seized);
        self.close_if_paid(id);
    }

    /// The operator's earned share. Locked while behind on payments, the same
    /// way a real loan's cash trap works.
    pub fn withdraw_operator(&mut self, amount: Option<U128>) {
        self.assert_operator();
        require!(!self.is_trapped(), errors::TRAPPED);
        let amount = amount.map_or(self.ledger.operator.0, |a| a.0);
        require!(amount > 0, errors::NOTHING_TO_WITHDRAW);
        require!(amount <= self.ledger.operator.0, errors::INSUFFICIENT);
        self.ledger.operator.0 -= amount;
        let operator = self.operator.clone();
        self.credit(&operator, amount);
        self.push(&operator);
    }

    /// Working capital belongs to the operator only when there is no loan.
    pub fn withdraw_opex(&mut self, amount: U128) {
        self.assert_operator();
        self.assert_no_open_loan();
        require!(amount.0 > 0, errors::NOTHING_TO_WITHDRAW);
        require!(amount.0 <= self.ledger.opex.0, errors::INSUFFICIENT);
        self.ledger.opex.0 -= amount.0;
        let operator = self.operator.clone();
        self.credit(&operator, amount.0);
        self.push(&operator);
    }

    /// Pays lenders out of working capital, for instance when the principal was
    /// not all needed. Only ever moves money towards lenders.
    pub fn repay_from_opex(&mut self, amount: U128) {
        self.assert_operator();
        let id = self.open_loan_id();
        let loan = self.loan(id);
        require!(loan.status == LoanStatus::Active, errors::NOT_ACTIVE);
        let outstanding = loan.terms.total_due.0 - loan.repaid.0;
        let accepted = amount.0.min(outstanding);
        require!(accepted > 0, errors::NOTHING_TO_WITHDRAW);
        require!(accepted <= self.ledger.opex.0, errors::INSUFFICIENT);
        self.ledger.opex.0 -= accepted;
        self.pay_lenders(id, accepted);
        events::repaid(id, &self.operator.clone(), accepted, outstanding - accepted);
        self.close_if_paid(id);
    }

    /// Replaces the service. Only possible with no open loan.
    pub fn update_service(&mut self, service: Service) {
        self.assert_operator();
        self.assert_no_open_loan();
        validate::service(&service, &self.operator);
        events::service_updated(&service.wasm.hash);
        self.service = service;
    }

    /// Hands the business to a new operator. Only possible with no open loan.
    #[payable]
    pub fn transfer_operator(&mut self, new_operator: AccountId) {
        near_sdk::assert_one_yocto();
        self.assert_operator();
        self.assert_no_open_loan();
        require!(
            !self.service.policy.vendors.contains(&new_operator),
            "the new operator is a vendor: remove them from the policy first"
        );
        let previous = std::mem::replace(&mut self.operator, new_operator.clone());
        let owed = std::mem::take(&mut self.ledger.operator.0);
        if owed > 0 {
            self.credit(&previous, owed);
            self.push(&previous);
        }
        events::operator_changed(&previous, &new_operator);
    }
}

impl AgentContract {
    pub(crate) fn open_loan_id(&self) -> u32 {
        self.current_loan.unwrap_or_else(|| env::panic_str(errors::NO_OPEN_LOAN))
    }

    pub(crate) fn loan(&self, id: u32) -> Loan {
        self.loans.get(id).cloned().unwrap_or_else(|| env::panic_str("unknown loan"))
    }

    pub(crate) fn loan_mut(&mut self, id: u32) -> &mut Loan {
        self.loans.get_mut(id).unwrap_or_else(|| env::panic_str("unknown loan"))
    }

    pub(crate) fn schedule(loan: &Loan) -> Schedule {
        Schedule {
            activated_at: loan.activated_at.unwrap_or_else(|| env::panic_str(errors::NOT_ACTIVE)),
            term_secs: loan.terms.term_secs,
            window_secs: loan.terms.window_secs,
            min_payment_per_window: loan.terms.min_payment_per_window.0,
            total_due: loan.terms.total_due.0,
        }
    }

    /// True while the operator's share is diverted to lenders.
    pub(crate) fn is_trapped(&self) -> bool {
        let Some(id) = self.current_loan else { return false };
        let loan = self.loan(id);
        match loan.status {
            LoanStatus::Foreclosed => true,
            LoanStatus::Active => Self::schedule(&loan).is_behind(loan.repaid.0, self.now()),
            _ => false,
        }
    }

    /// Accepts lender money. Returns the part not needed.
    pub(crate) fn accept_funding(&mut self, lender: AccountId, amount: u128, loan_id: u32) -> u128 {
        let id = self.open_loan_id();
        require!(id == loan_id, "that loan is not the one open for funding");
        let loan = self.loan(id);
        require!(loan.status == LoanStatus::Funding, errors::NOT_FUNDING);
        require!(self.now() < loan.funding_deadline, "the funding deadline has passed");

        let principal = loan.terms.principal.0;
        let remaining = principal - loan.funded.0;
        let accepted = amount.min(remaining);
        require!(
            accepted == remaining || accepted >= (principal / MIN_NOTE_DIVISOR).max(1),
            "below the minimum note size of 2% of principal"
        );

        let key = (id, lender.clone());
        let mut note = self.notes.get(&key).cloned();
        let is_new = note.is_none();
        require!(!is_new || loan.holders < MAX_NOTES, "this loan already has 50 lenders");
        let entry = note.get_or_insert_with(Note::default);
        entry.principal.0 += accepted;
        self.notes.insert(key, entry.clone());

        self.ledger.funding_escrow.0 += accepted;
        let now = self.now();
        let loan = self.loan_mut(id);
        loan.funded.0 += accepted;
        if is_new {
            loan.holders += 1;
        }
        let full = loan.funded.0 == principal;
        if full {
            loan.status = LoanStatus::Active;
            loan.activated_at = Some(now);
        }
        events::funded(id, &lender, accepted);
        if full {
            // The principal becomes working capital, which the operator cannot
            // withdraw. It can only leave through the agent's own spending.
            self.ledger.funding_escrow.0 -= principal;
            self.ledger.opex.0 += principal;
            events::activated(id, U128(principal));
        }
        amount - accepted
    }

    /// Runs one inflow through the waterfall.
    pub(crate) fn recognize_revenue(&mut self, amount: u128, source: &str) {
        let open = self.current_loan.map(|id| self.loan(id));
        let Some(loan) = open.filter(|l| matches!(l.status, LoanStatus::Active | LoanStatus::Foreclosed)) else {
            self.ledger.opex.0 += amount;
            events::revenue(source, amount, 0, 0, amount);
            return;
        };
        let outstanding = loan.terms.total_due.0 - loan.repaid.0;
        let split = split_inflow(
            amount,
            outstanding,
            loan.terms.lender_bps,
            loan.terms.operator_bps,
            self.is_trapped(),
        );
        self.ledger.operator.0 += split.operator;
        self.ledger.opex.0 += split.opex;
        self.pay_lenders(loan.id, split.lender);
        events::revenue(source, amount, split.lender, split.operator, split.opex);
        self.close_if_paid(loan.id);
    }

    /// Direct repayment by anyone, including redeeming a foreclosed business
    /// before it is sold. Returns the part not needed.
    pub(crate) fn accept_repayment(&mut self, by: AccountId, amount: u128) -> u128 {
        let id = self.open_loan_id();
        let loan = self.loan(id);
        require!(
            matches!(loan.status, LoanStatus::Active | LoanStatus::Foreclosed),
            errors::NOT_ACTIVE
        );
        let outstanding = loan.terms.total_due.0 - loan.repaid.0;
        let accepted = amount.min(outstanding);
        self.pay_lenders(id, accepted);
        events::repaid(id, &by, accepted, outstanding - accepted);
        self.close_if_paid(id);
        amount - accepted
    }

    pub(crate) fn pay_lenders(&mut self, id: u32, amount: u128) {
        if amount == 0 {
            return;
        }
        self.ledger.lender_pool.0 += amount;
        self.loan_mut(id).repaid.0 += amount;
    }

    /// A fully paid loan closes at once. If the business was in foreclosure, the
    /// original operator gets it back and any standing bid is returned.
    pub(crate) fn close_if_paid(&mut self, id: u32) {
        let loan = self.loan(id);
        if loan.repaid.0 < loan.terms.total_due.0 {
            return;
        }
        let now = self.now();
        let standing = {
            let loan = self.loan_mut(id);
            loan.status = LoanStatus::Repaid;
            loan.closed_at = Some(now);
            loan.auction.high_bidder.take().map(|b| (b, loan.auction.high_bid.0))
        };
        self.current_loan = None;
        self.proposal = None;
        if let Some((bidder, bid)) = standing {
            self.ledger.auction_escrow.0 -= bid;
            self.credit(&bidder, bid);
            self.push(&bidder);
        }
        events::loan_closed(id, "repaid");
    }

    pub(crate) fn assert_amount(amount: u128) {
        require!(amount <= MAX_AMOUNT, errors::AMOUNT_TOO_LARGE);
    }
}
