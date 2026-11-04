//! Turns chain facts into a score. The rules are fixed and public, so two runs on
//! the same state give the same answer and anyone can check why.

use crate::chain::Facts;
use serde::Serialize;

#[derive(Serialize, Debug, Clone, PartialEq)]
pub struct Report {
    pub target: String,
    pub network: String,
    /// 0 is safest, 100 is riskiest.
    pub score: u8,
    pub level: &'static str,
    pub flags: Vec<&'static str>,
    pub keys: [u32; 2],
    #[serde(skip_serializing_if = "Option::is_none")]
    pub verdict: Option<String>,
    /// Set when a model key was present but the model gave no answer, so a reader
    /// can tell "no AI configured" from "AI failed".
    #[serde(skip_serializing_if = "Option::is_none")]
    pub verdict_error: Option<&'static str>,
}

/// Accepts a bare account, or a sentence with one in it.
pub fn parse_target(input: &str) -> Result<String, String> {
    let found = input
        .split(|c: char| c.is_whitespace() || matches!(c, ',' | ';' | '"' | '\'' | '?' | '(' | ')'))
        .map(|w| w.trim_end_matches('.').to_ascii_lowercase())
        .find(|w| is_account(w));
    found.ok_or_else(|| "no NEAR account found in the input".to_string())
}

fn is_account(word: &str) -> bool {
    let named = word.ends_with(".near") || word.ends_with(".testnet") || word == "near" || word == "testnet";
    let implicit = word.len() == 64 && word.bytes().all(|b| b.is_ascii_hexdigit());
    (named || implicit)
        && word.len() >= 2
        && word.len() <= 64
        && word
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || matches!(b, b'.' | b'-' | b'_'))
        && !word.contains("..")
}

pub fn assess(target: &str, network: &str, facts: &Facts) -> Report {
    let mut score: u8 = 0;
    let mut flags = Vec::new();
    let mut add = |points: u8, flag: &'static str| {
        score = score.saturating_add(points);
        flags.push(flag);
    };

    if !facts.exists {
        add(90, "account_does_not_exist");
    } else {
        if facts.has_contract && facts.full_access_keys > 0 {
            add(40, "owner_can_replace_contract_code");
        }
        if facts.has_contract && facts.full_access_keys == 0 {
            // A good sign, so it is noted without adding risk.
            add(0, "contract_is_locked_no_one_can_change_it");
        }
        if !facts.has_contract && facts.full_access_keys == 0 && facts.function_call_keys == 0 {
            add(50, "account_is_locked_with_no_code");
        }
        if facts.full_access_keys > 3 {
            add(20, "many_full_access_keys");
        }
        if facts.balance_near < 1 {
            add(15, "almost_no_balance");
        }
        if facts.has_contract && facts.storage_bytes < 50_000 {
            add(10, "very_small_contract");
        }
    }

    let score = score.min(100);
    Report {
        target: target.to_string(),
        network: network.to_string(),
        score,
        level: match score {
            0..=19 => "low",
            20..=49 => "medium",
            _ => "high",
        },
        flags,
        keys: [facts.full_access_keys, facts.function_call_keys],
        verdict: None,
        verdict_error: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn facts() -> Facts {
        Facts { exists: true, has_contract: false, full_access_keys: 1, function_call_keys: 0, balance_near: 10, storage_bytes: 200 }
    }

    #[test]
    fn finds_the_account_in_a_sentence() {
        assert_eq!(parse_target("is bob.near safe?").unwrap(), "bob.near");
        assert_eq!(parse_target("  Alice.Testnet ").unwrap(), "alice.testnet");
        assert_eq!(parse_target("usdc.near.").unwrap(), "usdc.near");
    }

    #[test]
    fn rejects_input_without_an_account() {
        assert!(parse_target("hello world").is_err());
        assert!(parse_target("").is_err());
        assert!(parse_target("a..near").is_err());
        assert!(parse_target(&format!("{}.near", "a".repeat(70))).is_err());
    }

    #[test]
    fn accepts_an_implicit_account() {
        let hex = "ab".repeat(32);
        assert_eq!(parse_target(&hex).unwrap(), hex);
    }

    #[test]
    fn a_plain_funded_account_is_low_risk() {
        let r = assess("a.near", "mainnet", &facts());
        assert_eq!(r.score, 0);
        assert_eq!(r.level, "low");
        assert!(r.flags.is_empty());
    }

    #[test]
    fn a_missing_account_is_high_risk() {
        let r = assess("gone.near", "mainnet", &Facts::default());
        assert_eq!(r.level, "high");
        assert_eq!(r.flags, vec!["account_does_not_exist"]);
    }

    #[test]
    fn an_upgradable_contract_is_flagged() {
        let f = Facts { has_contract: true, storage_bytes: 400_000, ..facts() };
        let r = assess("c.near", "mainnet", &f);
        assert_eq!(r.flags, vec!["owner_can_replace_contract_code"]);
        assert_eq!(r.level, "medium");
    }

    #[test]
    fn a_keyless_contract_is_noted_as_good() {
        let f = Facts { has_contract: true, full_access_keys: 0, storage_bytes: 400_000, ..facts() };
        let r = assess("c.near", "mainnet", &f);
        assert_eq!(r.score, 0);
        assert_eq!(r.flags, vec!["contract_is_locked_no_one_can_change_it"]);
    }

    #[test]
    fn scores_never_pass_100() {
        let f = Facts { has_contract: true, full_access_keys: 9, balance_near: 0, storage_bytes: 10, ..facts() };
        let r = assess("c.near", "mainnet", &f);
        assert!(r.score <= 100);
        assert_eq!(r.level, "high");
    }
}
