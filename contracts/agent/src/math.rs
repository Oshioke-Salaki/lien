//! Every number that decides who gets paid. Pure functions, no chain access,
//! so the money rules can be property-tested on their own.

pub const BPS: u128 = 10_000;

/// Largest amount the contract accepts in one transfer or term. Keeping amounts
/// below 1e18 means `a * b` of any two of them fits in a u128 (max ~3.4e38), so
/// the arithmetic below needs no wide integers. For a 6-decimal stablecoin this
/// is one trillion dollars.
pub const MAX_AMOUNT: u128 = 1_000_000_000_000_000_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Split {
    pub lender: u128,
    pub operator: u128,
    pub opex: u128,
}

/// Divides one inflow between lenders, the operator and the agent's working
/// capital. While `trapped` (behind on payments or foreclosed), the operator's
/// share goes to lenders instead.
pub fn split_inflow(
    amount: u128,
    outstanding: u128,
    lender_bps: u16,
    operator_bps: u16,
    trapped: bool,
) -> Split {
    let (lender_bps, operator_bps) = if trapped {
        (lender_bps as u128 + operator_bps as u128, 0)
    } else {
        (lender_bps as u128, operator_bps as u128)
    };
    let lender = (amount * lender_bps / BPS).min(outstanding);
    let operator = amount * operator_bps / BPS;
    Split {
        lender,
        operator,
        opex: amount - lender - operator,
    }
}

/// The schedule a loan is measured against, in seconds and token units.
#[derive(Debug, Clone, Copy)]
pub struct Schedule {
    pub activated_at: u64,
    pub term_secs: u64,
    pub window_secs: u64,
    pub min_payment_per_window: u128,
    pub total_due: u128,
}

impl Schedule {
    pub fn maturity(&self) -> u64 {
        self.activated_at + self.term_secs
    }

    /// The moment the borrower falls behind given what lenders have received,
    /// or `None` if the debt is fully paid. Derived rather than stored, so
    /// nobody has to call anything for the clock to start and a payment cures
    /// a breach by itself.
    pub fn breach_time(&self, repaid: u128) -> Option<u64> {
        if repaid >= self.total_due {
            return None;
        }
        if self.min_payment_per_window == 0 {
            return Some(self.maturity());
        }
        let windows_covered = repaid / self.min_payment_per_window;
        let breach_window = windows_covered.saturating_add(1);
        let offset = breach_window.saturating_mul(self.window_secs as u128);
        let at = (self.activated_at as u128).saturating_add(offset);
        Some(at.min(self.maturity() as u128) as u64)
    }

    pub fn is_behind(&self, repaid: u128, now: u64) -> bool {
        self.breach_time(repaid).is_some_and(|at| now >= at)
    }

    pub fn can_foreclose(&self, repaid: u128, now: u64, grace_secs: u64) -> bool {
        self.breach_time(repaid)
            .is_some_and(|at| now >= at.saturating_add(grace_secs))
    }
}

/// What a note may still withdraw. Rounds down, so the sum over all notes can
/// never exceed what lenders were paid.
pub fn claimable(pool_total: u128, note_principal: u128, funded: u128, claimed: u128) -> u128 {
    if funded == 0 {
        return 0;
    }
    (pool_total * note_principal / funded).saturating_sub(claimed)
}

/// The lowest acceptable next bid: the reserve for a first bid, 5% over the
/// current high bid after that.
pub fn min_bid(outstanding: u128, reserve_bps: u16, high_bid: u128) -> u128 {
    if high_bid == 0 {
        (outstanding * reserve_bps as u128 / BPS).max(1)
    } else {
        high_bid + (high_bid / 20).max(1)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use proptest::prelude::*;

    fn schedule(min_payment: u128) -> Schedule {
        Schedule {
            activated_at: 1_000,
            term_secs: 1_000,
            window_secs: 100,
            min_payment_per_window: min_payment,
            total_due: 1_000,
        }
    }

    #[test]
    fn split_gives_each_party_its_share() {
        let s = split_inflow(1_000, 10_000, 3_000, 2_000, false);
        assert_eq!(s, Split { lender: 300, operator: 200, opex: 500 });
    }

    #[test]
    fn lender_share_stops_at_the_debt_and_the_rest_stays_in_the_business() {
        let s = split_inflow(1_000, 50, 3_000, 2_000, false);
        assert_eq!(s, Split { lender: 50, operator: 200, opex: 750 });
    }

    #[test]
    fn trap_redirects_the_operator_share_to_lenders() {
        let s = split_inflow(1_000, 10_000, 3_000, 2_000, true);
        assert_eq!(s, Split { lender: 500, operator: 0, opex: 500 });
    }

    #[test]
    fn breach_starts_at_the_first_window_that_was_not_covered() {
        let s = schedule(100);
        assert_eq!(s.breach_time(0), Some(1_100));
        assert_eq!(s.breach_time(99), Some(1_100));
        assert_eq!(s.breach_time(100), Some(1_200));
        assert_eq!(s.breach_time(350), Some(1_400));
    }

    #[test]
    fn maturity_is_a_hard_stop_even_when_ahead_of_schedule() {
        let s = schedule(100);
        assert_eq!(s.breach_time(999), Some(2_000));
    }

    #[test]
    fn a_paid_loan_can_never_breach() {
        assert_eq!(schedule(100).breach_time(1_000), None);
        assert!(!schedule(100).is_behind(1_000, u64::MAX));
    }

    #[test]
    fn no_minimum_means_only_maturity_counts() {
        let s = schedule(0);
        assert_eq!(s.breach_time(0), Some(2_000));
        assert!(!s.is_behind(0, 1_999));
        assert!(s.is_behind(0, 2_000));
    }

    #[test]
    fn foreclosure_waits_for_the_grace_period() {
        let s = schedule(100);
        assert!(s.is_behind(0, 1_100));
        assert!(!s.can_foreclose(0, 1_149, 50));
        assert!(s.can_foreclose(0, 1_150, 50));
    }

    #[test]
    fn a_payment_cures_a_breach() {
        let s = schedule(100);
        assert!(s.can_foreclose(0, 1_500, 50));
        assert!(!s.is_behind(500, 1_500));
    }

    #[test]
    fn claimable_handles_an_unfunded_loan() {
        assert_eq!(claimable(100, 10, 0, 0), 0);
    }

    #[test]
    fn claimable_never_underflows_after_a_full_claim() {
        assert_eq!(claimable(100, 50, 100, 50), 0);
        assert_eq!(claimable(100, 50, 100, 60), 0);
    }

    #[test]
    fn first_bid_must_meet_the_reserve_and_later_bids_must_beat_by_five_percent() {
        assert_eq!(min_bid(1_000, 5_000, 0), 500);
        assert_eq!(min_bid(1_000, 0, 0), 1);
        assert_eq!(min_bid(1_000, 5_000, 600), 630);
        assert_eq!(min_bid(1_000, 5_000, 1), 2);
    }

    proptest! {
        #[test]
        fn split_conserves_every_unit(
            amount in 0..=MAX_AMOUNT,
            outstanding in 0..=MAX_AMOUNT,
            lender_bps in 0u16..=10_000,
            operator_share in 0u16..=10_000,
            trapped: bool,
        ) {
            let operator_bps = operator_share.min(10_000 - lender_bps);
            let s = split_inflow(amount, outstanding, lender_bps, operator_bps, trapped);
            prop_assert_eq!(s.lender + s.operator + s.opex, amount);
            prop_assert!(s.lender <= outstanding);
            if trapped {
                prop_assert_eq!(s.operator, 0);
            }
        }

        #[test]
        fn notes_together_never_claim_more_than_the_pool(
            pool in 0..=MAX_AMOUNT,
            notes in proptest::collection::vec(1u128..=1_000_000_000_000, 1..50),
        ) {
            let funded: u128 = notes.iter().sum();
            let pool = pool.min(funded);
            let total: u128 = notes.iter().map(|n| claimable(pool, *n, funded, 0)).sum();
            prop_assert!(total <= pool);
            // Rounding loses at most one unit per note.
            prop_assert!(pool - total < notes.len() as u128);
        }

        #[test]
        fn claiming_in_steps_pays_the_same_as_claiming_once(
            payments in proptest::collection::vec(1u128..=1_000_000, 1..30),
            note in 1u128..=1_000_000,
            extra in 0u128..=1_000_000,
        ) {
            let funded = note + extra;
            let mut pool = 0u128;
            let mut claimed = 0u128;
            for p in &payments {
                pool += p;
                let pool_capped = pool.min(funded);
                claimed += claimable(pool_capped, note, funded, claimed);
            }
            let pool_capped = pool.min(funded);
            prop_assert_eq!(claimed, pool_capped * note / funded);
        }

        #[test]
        fn paying_more_never_brings_the_breach_forward(
            a in 0u128..=2_000,
            b in 0u128..=2_000,
            min_payment in 0u128..=500,
        ) {
            let s = schedule(min_payment);
            let (lo, hi) = (a.min(b), a.max(b));
            match (s.breach_time(lo), s.breach_time(hi)) {
                (Some(x), Some(y)) => prop_assert!(y >= x),
                (Some(_), None) | (None, None) => {}
                (None, Some(_)) => prop_assert!(false, "paying more created a breach"),
            }
        }

        #[test]
        fn every_unpaid_loan_breaches_by_maturity(
            repaid in 0u128..1_000,
            min_payment in 0u128..=500,
        ) {
            let s = schedule(min_payment);
            prop_assert!(s.is_behind(repaid, s.maturity()));
        }

        #[test]
        fn every_valid_bid_strictly_increases(high in 1u128..=MAX_AMOUNT, out in 0u128..=MAX_AMOUNT) {
            prop_assert!(min_bid(out, 5_000, high) > high);
        }
    }
}
