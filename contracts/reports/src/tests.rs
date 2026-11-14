use super::*;
use near_sdk::test_utils::{get_logs, VMContextBuilder};
use near_sdk::testing_env;

const EVIDENCE: &str = "https://github.com/Oshioke-Salaki/lien/blob/main/agents/lender/logs/attack.jsonl";

fn as_caller(who: &str, deposit: NearToken, ts_ms: u64) {
    let mut ctx = VMContextBuilder::new();
    ctx.current_account_id("reports.lien-13569.testnet".parse().unwrap())
        .predecessor_account_id(who.parse().unwrap())
        .attached_deposit(deposit)
        .block_timestamp(ts_ms * 1_000_000);
    testing_env!(ctx.build());
}

fn acc(s: &str) -> AccountId {
    s.parse().unwrap()
}

fn file(c: &mut Reports, who: &str, target: &str) -> u64 {
    as_caller(who, BOND, 1_000);
    c.report(acc(target), "Named in a prompt injection".into(), EVIDENCE.into())
}

#[test]
fn a_report_stores_reporter_time_reason_and_evidence() {
    let mut c = Reports::default();
    as_caller("alice.testnet", BOND, 1_700_000_000_000);
    let id = c.report(acc("attacker.testnet"), "  Named as the payee in a prompt injection  ".into(), EVIDENCE.into());
    assert_eq!(id, 0);
    let got = c.get_reports(acc("attacker.testnet"));
    assert_eq!(got.len(), 1);
    let r = &got[0];
    assert_eq!(r.reporter, acc("alice.testnet"));
    assert_eq!(r.account, acc("attacker.testnet"));
    assert_eq!(r.reason, "Named as the payee in a prompt injection");
    assert_eq!(r.evidence_url, EVIDENCE);
    assert_eq!(r.created_at_ms, 1_700_000_000_000);
    assert_eq!(r.bond, U128(50_000_000_000_000_000_000_000));
    assert_eq!(r.retracted_at_ms, None);
    assert!(c.is_reported(acc("attacker.testnet")));
    assert!(get_logs()[0].starts_with("REPORT 0 against attacker.testnet by alice.testnet"));
}

#[test]
fn an_account_with_no_reports_is_not_reported() {
    let c = Reports::default();
    assert!(c.get_reports(acc("bob.testnet")).is_empty());
    assert!(!c.is_reported(acc("bob.testnet")));
    assert_eq!(c.count(), 0);
    assert_eq!(c.bond(), U128(BOND.as_yoctonear()));
}

#[test]
#[should_panic(expected = "Attach exactly 0.05 NEAR")]
fn no_bond_is_refused() {
    let mut c = Reports::default();
    as_caller("alice.testnet", NearToken::from_yoctonear(0), 1);
    c.report(acc("attacker.testnet"), "x".into(), EVIDENCE.into());
}

#[test]
#[should_panic(expected = "Attach exactly 0.05 NEAR")]
fn too_much_bond_is_refused() {
    let mut c = Reports::default();
    as_caller("alice.testnet", NearToken::from_near(1), 1);
    c.report(acc("attacker.testnet"), "x".into(), EVIDENCE.into());
}

#[test]
#[should_panic(expected = "cannot report yourself")]
fn reporting_yourself_is_refused() {
    let mut c = Reports::default();
    file(&mut c, "alice.testnet", "alice.testnet");
}

#[test]
#[should_panic(expected = "reason must be 1 to 280 bytes")]
fn an_empty_reason_is_refused() {
    let mut c = Reports::default();
    as_caller("alice.testnet", BOND, 1);
    c.report(acc("attacker.testnet"), "   ".into(), EVIDENCE.into());
}

#[test]
#[should_panic(expected = "reason must be 1 to 280 bytes")]
fn a_long_reason_is_refused() {
    let mut c = Reports::default();
    as_caller("alice.testnet", BOND, 1);
    c.report(acc("attacker.testnet"), "x".repeat(281), EVIDENCE.into());
}

#[test]
fn bad_evidence_links_are_refused() {
    for url in ["http://example.com/x", "https://", "ftp://x", "https://exa mple.com", &format!("https://{}", "a".repeat(300))] {
        let mut c = Reports::default();
        as_caller("alice.testnet", BOND, 1);
        let out = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| c.report(acc("attacker.testnet"), "x".into(), url.into())));
        assert!(out.is_err(), "accepted {url}");
    }
}

#[test]
#[should_panic(expected = "already have an active report")]
fn a_second_active_report_by_the_same_reporter_is_refused() {
    let mut c = Reports::default();
    file(&mut c, "alice.testnet", "attacker.testnet");
    file(&mut c, "alice.testnet", "attacker.testnet");
}

#[test]
fn different_reporters_each_add_a_report() {
    let mut c = Reports::default();
    file(&mut c, "alice.testnet", "attacker.testnet");
    file(&mut c, "bob.testnet", "attacker.testnet");
    file(&mut c, "bob.testnet", "other.testnet");
    let got = c.get_reports(acc("attacker.testnet"));
    assert_eq!(got.iter().map(|r| r.reporter.as_str()).collect::<Vec<_>>(), ["alice.testnet", "bob.testnet"]);
    assert_eq!(c.get_reports(acc("other.testnet")).len(), 1);
    assert_eq!(c.count(), 3);
}

#[test]
fn the_reporter_can_retract_and_it_stops_counting_but_stays_in_history() {
    let mut c = Reports::default();
    let id = file(&mut c, "alice.testnet", "attacker.testnet");
    as_caller("alice.testnet", NearToken::from_yoctonear(0), 5_000);
    c.retract(id);
    let got = c.get_reports(acc("attacker.testnet"));
    assert_eq!(got.len(), 1);
    assert_eq!(got[0].retracted_at_ms, Some(5_000));
    assert!(!c.is_reported(acc("attacker.testnet")));
    // After retracting, the same reporter may file again.
    let again = file(&mut c, "alice.testnet", "attacker.testnet");
    assert_eq!(again, 1);
    assert!(c.is_reported(acc("attacker.testnet")));
}

#[test]
fn one_active_report_is_enough_to_count() {
    let mut c = Reports::default();
    let a = file(&mut c, "alice.testnet", "attacker.testnet");
    file(&mut c, "bob.testnet", "attacker.testnet");
    as_caller("alice.testnet", NearToken::from_yoctonear(0), 2);
    c.retract(a);
    assert!(c.is_reported(acc("attacker.testnet")));
}

#[test]
#[should_panic(expected = "Only the reporter can retract")]
fn someone_else_cannot_retract() {
    let mut c = Reports::default();
    let id = file(&mut c, "alice.testnet", "attacker.testnet");
    as_caller("attacker.testnet", NearToken::from_yoctonear(0), 2);
    c.retract(id);
}

#[test]
#[should_panic(expected = "already retracted")]
fn retracting_twice_is_refused() {
    let mut c = Reports::default();
    let id = file(&mut c, "alice.testnet", "attacker.testnet");
    as_caller("alice.testnet", NearToken::from_yoctonear(0), 2);
    c.retract(id);
    c.retract(id);
}

#[test]
#[should_panic(expected = "No such report")]
fn retracting_a_missing_report_is_refused() {
    let mut c = Reports::default();
    as_caller("alice.testnet", NearToken::from_yoctonear(0), 2);
    c.retract(7);
}

#[test]
fn list_reports_pages_in_filing_order_and_caps_the_limit() {
    let mut c = Reports::default();
    for i in 0..5 {
        file(&mut c, &format!("r{i}.testnet"), "attacker.testnet");
    }
    assert_eq!(c.list_reports(None, None).len(), 5);
    assert_eq!(c.list_reports(Some(1), Some(2)).iter().map(|r| r.id).collect::<Vec<_>>(), [1, 2]);
    assert_eq!(c.list_reports(Some(4), Some(10)).len(), 1);
    assert!(c.list_reports(Some(9), Some(10)).is_empty());
    assert!(c.list_reports(Some(u64::MAX), Some(u64::MAX)).is_empty());
    for i in 5..(MAX_LIMIT + 3) {
        file(&mut c, &format!("r{i}.testnet"), "x.testnet");
    }
    assert_eq!(c.list_reports(Some(0), Some(1_000)).len() as u64, MAX_LIMIT);
}
