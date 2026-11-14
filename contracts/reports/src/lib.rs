//! A shared, on-chain blocklist of NEAR accounts.
//!
//! Anyone can report an account with a short reason and a link to evidence,
//! attaching a bond of exactly 0.05 NEAR. The bond stays with the contract: it
//! pays for the record's storage and makes spam cost something. Every report
//! keeps who filed it and when, so a reader can weigh the reporter, not just the
//! report.
//!
//! The rule for readers is simple and public: an account with at least one
//! report that its reporter has not retracted counts as reported. Lien's
//! counterparty check treats that as BLOCK and shows each reporter and evidence
//! link next to the verdict.
//!
//! A reporter can retract their own report. A retracted report stays in the
//! history, marked as retracted, and the bond is not returned (it still pays for
//! the record). There is no owner, no admin, no setter and no upgrade method,
//! and the account that runs this contract holds no access keys, so no one can
//! delete or edit a report.
//!
//! What this does not do: it does not check that a report is true. It records
//! who said what, with what evidence, at what time.

use near_sdk::json_types::U128;
use near_sdk::store::{LookupMap, Vector};
use near_sdk::{env, near, require, AccountId, BorshStorageKey, NearToken};

/// 0.05 NEAR, attached exactly to every report.
pub const BOND: NearToken = NearToken::from_millinear(50);
/// Longest reason, in bytes.
pub const MAX_REASON: usize = 280;
/// Longest evidence link, in bytes.
pub const MAX_URL: usize = 300;
/// Most reports a list view returns at once.
pub const MAX_LIMIT: u64 = 100;

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq)]
pub struct Report {
    pub id: u64,
    /// The reported account.
    pub account: AccountId,
    /// Who filed it (the predecessor of the `report` call).
    pub reporter: AccountId,
    pub reason: String,
    /// An `https://` link to the evidence.
    pub evidence_url: String,
    /// Block time when it was filed, in milliseconds since the Unix epoch.
    pub created_at_ms: u64,
    pub bond: U128,
    /// Set when the reporter retracts it. A retracted report no longer counts.
    pub retracted_at_ms: Option<u64>,
}

#[derive(BorshStorageKey)]
#[near]
enum Key {
    Reports,
    ByAccount,
}

#[near(contract_state)]
pub struct Reports {
    reports: Vector<Report>,
    /// Report ids per reported account, oldest first.
    by_account: LookupMap<AccountId, Vec<u64>>,
}

impl Default for Reports {
    fn default() -> Self {
        Self { reports: Vector::new(Key::Reports), by_account: LookupMap::new(Key::ByAccount) }
    }
}

#[near]
impl Reports {
    /// Files a report against `account`. Attach exactly 0.05 NEAR. Returns the report id.
    ///
    /// Refused: the wrong bond, an empty or overlong reason, an evidence link that is
    /// not `https://` or is overlong, reporting yourself, and a second active report by
    /// the same reporter against the same account.
    #[payable]
    pub fn report(&mut self, account: AccountId, reason: String, evidence_url: String) -> u64 {
        require!(env::attached_deposit() == BOND, "Attach exactly 0.05 NEAR as the report bond");
        let reporter = env::predecessor_account_id();
        require!(reporter != account, "You cannot report yourself");
        let reason = reason.trim().to_string();
        require!(!reason.is_empty() && reason.len() <= MAX_REASON, "The reason must be 1 to 280 bytes");
        let evidence_url = evidence_url.trim().to_string();
        require!(
            evidence_url.len() > "https://".len() && evidence_url.len() <= MAX_URL && evidence_url.starts_with("https://"),
            "The evidence link must be an https:// URL of at most 300 bytes"
        );
        require!(!evidence_url.chars().any(|c| c.is_whitespace() || c.is_control()), "The evidence link must not contain spaces");

        let mut ids = self.by_account.get(&account).cloned().unwrap_or_default();
        let duplicate = ids.iter().any(|&id| {
            let r = &self.reports[id as u32];
            r.reporter == reporter && r.retracted_at_ms.is_none()
        });
        require!(!duplicate, "You already have an active report on this account");

        let id = self.reports.len() as u64;
        let report = Report {
            id,
            account: account.clone(),
            reporter,
            reason,
            evidence_url,
            created_at_ms: env::block_timestamp_ms(),
            bond: U128(BOND.as_yoctonear()),
            retracted_at_ms: None,
        };
        env::log_str(&format!("REPORT {} against {} by {}: {}", id, report.account, report.reporter, report.evidence_url));
        self.reports.push(report);
        ids.push(id);
        self.by_account.insert(account, ids);
        id
    }

    /// The reporter withdraws report `id`. It stays in the history, marked as retracted,
    /// and stops counting. The bond is not returned.
    pub fn retract(&mut self, id: u64) {
        require!(id < self.reports.len() as u64, "No such report");
        let report = &mut self.reports[id as u32];
        require!(report.reporter == env::predecessor_account_id(), "Only the reporter can retract a report");
        require!(report.retracted_at_ms.is_none(), "This report is already retracted");
        report.retracted_at_ms = Some(env::block_timestamp_ms());
        env::log_str(&format!("RETRACT {} against {} by {}", id, report.account, report.reporter));
    }

    /// Every report on `account`, oldest first, retracted ones included (check `retracted_at_ms`).
    pub fn get_reports(&self, account: AccountId) -> Vec<Report> {
        self.by_account
            .get(&account)
            .map(|ids| ids.iter().map(|&id| self.reports[id as u32].clone()).collect())
            .unwrap_or_default()
    }

    /// True when `account` has at least one report that has not been retracted.
    pub fn is_reported(&self, account: AccountId) -> bool {
        self.get_reports(account).iter().any(|r| r.retracted_at_ms.is_none())
    }

    /// Reports in filing order, starting at id `from`, at most `limit` (capped at 100).
    pub fn list_reports(&self, from: Option<u64>, limit: Option<u64>) -> Vec<Report> {
        let from = from.unwrap_or(0);
        let limit = limit.unwrap_or(MAX_LIMIT).min(MAX_LIMIT);
        let len = self.reports.len() as u64;
        (from..len.min(from.saturating_add(limit))).map(|id| self.reports[id as u32].clone()).collect()
    }

    /// How many reports have been filed, retracted ones included.
    pub fn count(&self) -> u64 {
        self.reports.len() as u64
    }

    /// The bond a report needs, in yoctoNEAR.
    pub fn bond(&self) -> U128 {
        U128(BOND.as_yoctonear())
    }
}

#[cfg(test)]
mod tests;
