//! Expected payloads were computed independently with ethers v6
//! (`Transaction.from({...}).unsignedHash`), not with this crate.

use super::*;
use near_sdk::test_utils::{get_logs, VMContextBuilder};
use near_sdk::testing_env;

const RECIPIENT: &str = "0x5eee75727d804a2b13038928d36f8b188945a57a";
const USDC: &str = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const CAP: u128 = 2_000_000_000;

fn setup(deposit: u128) {
    let mut ctx = VMContextBuilder::new();
    ctx.current_account_id("sentinel-x.v1.lien-13569.testnet".parse().unwrap())
        .predecessor_account_id("stranger.testnet".parse().unwrap())
        .attached_deposit(NearToken::from_yoctonear(deposit))
        .prepaid_gas(Gas::from_tgas(300));
    testing_env!(ctx.build());
}

fn vault(token: Option<&str>) -> XVault {
    XVault::new(
        "sentinel.v1.lien-13569.testnet".parse().unwrap(),
        "v1.signer-prod.testnet".parse().unwrap(),
        // Mixed case on purpose: stored lowercase.
        "0x5EEE75727d804a2b13038928d36f8b188945a57a".into(),
        token.map(String::from),
        U128(CAP),
    )
}

fn request() -> TransferRequest {
    TransferRequest {
        chain_id: 84532,
        to: RECIPIENT.into(),
        amount: U128(1_000_000_000_000),
        nonce: 0,
        max_fee_per_gas: U128(1_000_000_000),
        max_priority_fee_per_gas: U128(1_000_000),
        data: None,
    }
}

#[test]
fn the_allowed_eth_transfer_builds_the_expected_payload() {
    setup(0);
    let out = vault(None).build_transfer(request());
    assert_eq!(
        out.unsigned_tx,
        "0x02ee83014a3480830f4240843b9aca00825208945eee75727d804a2b13038928d36f8b188945a57a85e8d4a5100080c0"
    );
    assert_eq!(out.payload, "0x7cb18dbc2569430a7170e9ecdc2ff7ab2e85ad3decd089ee4ad97190b8c003a2");
}

#[test]
fn the_allowed_erc20_transfer_builds_the_expected_payload() {
    setup(0);
    let mut r = request();
    r.amount = U128(1_000_000);
    r.nonce = 3;
    let out = vault(Some(USDC)).build_transfer(r);
    assert_eq!(out.payload, "0x705ea382711af544e3e759921d9416341b7a7b58c99cdb6627ddf17e34107c51");
}

#[test]
fn sign_transfer_logs_the_same_payload_it_sends_to_the_signer() {
    setup(1);
    let _ = vault(None).sign_transfer(request());
    let logs = get_logs();
    assert_eq!(logs.len(), 1);
    assert!(logs[0].contains("\"payload\":\"7cb18dbc2569430a7170e9ecdc2ff7ab2e85ad3decd089ee4ad97190b8c003a2\""));
}

#[test]
fn the_address_path_is_this_account_and_evm_1() {
    setup(0);
    let p = vault(None).evm_address_path();
    assert_eq!(p.predecessor.as_str(), "sentinel-x.v1.lien-13569.testnet");
    assert_eq!(p.path, "evm-1");
    assert_eq!(p.mpc.as_str(), "v1.signer-prod.testnet");
    assert_eq!(p.domain_id, 0);
}

#[test]
fn the_policy_is_fixed_to_base_sepolia() {
    setup(0);
    let p = vault(Some(USDC)).policy();
    assert_eq!(p.chain_id, 84532);
    assert_eq!(p.recipient, RECIPIENT);
    assert_eq!(p.token.as_deref(), Some("0x036cbd53842c5426634e7929541ec2318f3dcf7e"));
}

#[test]
#[should_panic(expected = "refused: 0x000000000000000000000000000000000000dead is not the allowed recipient")]
fn a_wrong_recipient_is_refused() {
    setup(1);
    let mut r = request();
    r.to = "0x000000000000000000000000000000000000dEaD".into();
    let _ = vault(None).sign_transfer(r);
}

#[test]
#[should_panic(expected = "refused: chain id 1 is not allowed")]
fn a_wrong_chain_id_is_refused() {
    setup(1);
    let mut r = request();
    r.chain_id = 1;
    let _ = vault(None).sign_transfer(r);
}

#[test]
#[should_panic(expected = "refused: contract calls are not allowed")]
fn calldata_is_refused() {
    setup(1);
    let mut r = request();
    // approve(attacker, max) on the recipient: any calldata at all is refused.
    r.data = Some("0x095ea7b3000000000000000000000000000000000000000000000000000000000000dead".into());
    let _ = vault(None).sign_transfer(r);
}

#[test]
#[should_panic(expected = "refused: max_fee_per_gas")]
fn a_fee_above_the_cap_is_refused() {
    setup(1);
    let mut r = request();
    r.max_fee_per_gas = U128(CAP + 1);
    let _ = vault(None).sign_transfer(r);
}

#[test]
#[should_panic(expected = "attach at least 1 yoctoNEAR")]
fn signing_needs_the_signer_fee() {
    setup(0);
    let _ = vault(None).sign_transfer(request());
}

#[test]
fn empty_calldata_is_a_plain_transfer() {
    setup(0);
    let mut r = request();
    r.data = Some("0x".into());
    assert_eq!(vault(None).build_transfer(r).payload, "0x7cb18dbc2569430a7170e9ecdc2ff7ab2e85ad3decd089ee4ad97190b8c003a2");
}
