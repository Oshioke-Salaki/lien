//! Selling a foreclosed business. The debt can still be repaid until the sale
//! settles, which refunds the bidder and returns the business to its operator.

use crate::math::min_bid;
use crate::types::*;
use crate::{errors, events, AgentContract, AgentContractExt};
use near_sdk::json_types::U128;
use near_sdk::{near, require, AccountId};

/// A bid this close to the end extends the auction by the same amount, so the
/// business cannot be sniped in the last block.
const ANTI_SNIPE_SECS: u64 = 600;

#[near]
impl AgentContract {
    /// Completes a sale once the auction has ended. Anyone can call this. The
    /// price pays lenders first and any surplus goes to the former operator.
    pub fn settle_auction(&mut self) {
        let id = self.open_loan_id();
        let loan = self.loan(id);
        require!(loan.status == LoanStatus::Foreclosed, errors::NOT_FORECLOSED);
        let now = self.now();
        let ends_at = loan.auction.ends_at.unwrap_or_else(|| near_sdk::env::panic_str(errors::NO_BIDS));
        require!(now >= ends_at, errors::TOO_EARLY);
        let buyer = loan.auction.high_bidder.clone().unwrap_or_else(|| near_sdk::env::panic_str(errors::NO_BIDS));

        let price = loan.auction.high_bid.0;
        let outstanding = loan.terms.total_due.0 - loan.repaid.0;
        let to_lenders = price.min(outstanding);
        let surplus = price - to_lenders;

        self.ledger.auction_escrow.0 -= price;
        self.pay_lenders(id, to_lenders);
        let previous = std::mem::replace(&mut self.operator, buyer.clone());
        let owed = std::mem::take(&mut self.ledger.operator.0);
        self.credit(&previous, surplus + owed);
        self.push(&previous);

        let loan = self.loan_mut(id);
        loan.status = LoanStatus::Sold;
        loan.closed_at = Some(now);
        self.current_loan = None;
        self.proposal = None;
        // A vendor who buys the business must not be able to pay themselves.
        self.service.policy.vendors.retain(|v| v != &buyer);

        events::sold(id, &buyer, price, to_lenders, surplus);
        events::operator_changed(&previous, &buyer);
        events::loan_closed(id, "sold");
    }
}

impl AgentContract {
    pub(crate) fn accept_bid(&mut self, bidder: AccountId, amount: u128) {
        let id = self.open_loan_id();
        let loan = self.loan(id);
        require!(loan.status == LoanStatus::Foreclosed, errors::NOT_FORECLOSED);
        let now = self.now();
        if let Some(ends_at) = loan.auction.ends_at {
            require!(now < ends_at, errors::AUCTION_OVER);
        }
        let outstanding = loan.terms.total_due.0 - loan.repaid.0;
        let needed = min_bid(outstanding, loan.terms.auction_reserve_bps, loan.auction.high_bid.0);
        require!(amount >= needed, format!("the lowest acceptable bid is {needed}"));

        let previous = loan.auction.high_bidder.clone().map(|b| (b, loan.auction.high_bid.0));
        let ends_at = match loan.auction.ends_at {
            None => now + loan.terms.auction_secs,
            Some(ends) => ends.max(now + ANTI_SNIPE_SECS),
        };
        self.ledger.auction_escrow.0 += amount;
        let auction = &mut self.loan_mut(id).auction;
        auction.high_bidder = Some(bidder.clone());
        auction.high_bid = U128(amount);
        auction.ends_at = Some(ends_at);
        if let Some((outbid, bid)) = previous {
            self.ledger.auction_escrow.0 -= bid;
            self.credit(&outbid, bid);
            self.push(&outbid);
        }
        events::bid(id, &bidder, amount, ends_at);
    }
}
