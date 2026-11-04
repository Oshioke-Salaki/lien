//! Input checks. A bad value here would otherwise surface much later as a job
//! that always fails, or as a loan that can never behave as lenders expect.

use crate::math::{BPS, MAX_AMOUNT};
use crate::types::*;
use near_sdk::{require, AccountId};

const MAX_VENDORS: usize = 20;
const MAX_URL: usize = 2048;
/// OutLayer's published hard caps (`get_max_limits`).
const MAX_INSTRUCTIONS: u64 = 500_000_000_000;
const MAX_SECONDS: u64 = 180;
const MAX_MEMORY_MB: u32 = 4096;
const TEN_YEARS_SECS: u64 = 10 * 365 * 24 * 3600;

pub fn text(value: &str, min: usize, max: usize, field: &str) {
    require!(
        value.len() >= min && value.len() <= max,
        format!("{field} must be {min} to {max} bytes")
    );
}

fn is_sha256_hex(hash: &str) -> bool {
    hash.len() == 64 && hash.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

/// Same rule OutLayer applies to a secrets profile.
fn is_profile(profile: &str) -> bool {
    !profile.is_empty()
        && profile.len() <= 64
        && profile.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

pub fn service(service: &Service, operator: &AccountId) {
    let wasm = &service.wasm;
    require!(
        wasm.url.starts_with("https://")
            && wasm.url.len() <= MAX_URL
            && !wasm.url.chars().any(char::is_whitespace),
        "wasm url must be https, without spaces, and at most 2048 bytes"
    );
    require!(is_sha256_hex(&wasm.hash), "wasm hash must be 64 lowercase hex characters");
    require!(!wasm.build_target.is_empty(), "build_target is required");

    require!(service.price.0 > 0, "price must be above zero");
    require!(service.price.0 <= MAX_AMOUNT, crate::errors::AMOUNT_TOO_LARGE);
    require!(
        service.max_instructions > 0 && service.max_instructions <= MAX_INSTRUCTIONS,
        "max_instructions is outside OutLayer's limits"
    );
    require!(
        service.max_execution_seconds > 0 && service.max_execution_seconds <= MAX_SECONDS,
        "max_execution_seconds is outside OutLayer's limits"
    );
    require!(
        service.max_memory_mb > 0 && service.max_memory_mb <= MAX_MEMORY_MB,
        "max_memory_mb is outside OutLayer's limits"
    );
    require!(!service.compute_deposit.is_zero(), "compute_deposit must be above zero");
    if let Some(profile) = &service.secrets_profile {
        require!(is_profile(profile), "secrets_profile must be 1 to 64 letters, digits, - or _");
    }

    let policy = &service.policy;
    require!(policy.vendors.len() <= MAX_VENDORS, "at most 20 vendors");
    require!(
        !policy.vendors.contains(operator),
        "the operator cannot be a vendor: that would let them pay themselves"
    );
    require!(
        !policy.vendors.contains(&near_sdk::env::current_account_id()),
        "the agent cannot be its own vendor"
    );
    require!(
        policy.max_per_tx.0 <= policy.max_per_day.0,
        "max_per_tx cannot exceed max_per_day"
    );
    require!(policy.max_per_day.0 <= MAX_AMOUNT, crate::errors::AMOUNT_TOO_LARGE);
}

/// A vote can tighten how the agent spends, never loosen it. Otherwise a majority
/// of lenders, or an operator colluding with one, could vote a new vendor in and
/// drain the working capital away from everyone else.
pub fn no_wider_policy(current: &SpendPolicy, proposed: &SpendPolicy) {
    require!(
        proposed.vendors.iter().all(|v| current.vendors.contains(v)),
        "a vote cannot add vendors"
    );
    require!(
        proposed.max_per_tx.0 <= current.max_per_tx.0
            && proposed.max_per_day.0 <= current.max_per_day.0,
        "a vote cannot raise spending limits"
    );
}

pub fn terms(terms: &LoanTerms) {
    require!(terms.principal.0 > 0, "principal must be above zero");
    require!(terms.total_due.0 >= terms.principal.0, "total_due cannot be below principal");
    require!(terms.total_due.0 <= MAX_AMOUNT, crate::errors::AMOUNT_TOO_LARGE);
    require!(terms.lender_bps > 0, "lenders must receive a share of revenue");
    require!(
        terms.lender_bps as u128 + terms.operator_bps as u128 <= BPS,
        "lender and operator shares cannot exceed 100%"
    );
    require!(terms.auction_reserve_bps as u128 <= BPS, "reserve cannot exceed 100%");
    for (value, field) in [
        (terms.funding_secs, "funding_secs"),
        (terms.term_secs, "term_secs"),
        (terms.window_secs, "window_secs"),
        (terms.auction_secs, "auction_secs"),
    ] {
        require!(
            value > 0 && value <= TEN_YEARS_SECS,
            format!("{field} must be above zero and at most ten years")
        );
    }
    require!(terms.grace_secs <= TEN_YEARS_SECS, "grace_secs must be at most ten years");
    require!(terms.window_secs <= terms.term_secs, "window_secs cannot exceed term_secs");
    require!(
        terms.min_payment_per_window.0 <= terms.total_due.0,
        "min_payment_per_window cannot exceed total_due"
    );
}
