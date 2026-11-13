//! A keyless vault for a business's revenue on another chain.
//!
//! The account that runs this contract holds no access keys. Through NEAR Chain
//! Signatures it controls one EVM address, derived by the MPC signer from this
//! account's id and the fixed path `evm-1`. Only this contract can ask the
//! signer for a signature on that path, and this contract only ever asks for
//! one kind of transaction: a transfer, on Base Sepolia (chain id 84532), of
//! the asset fixed at init (native ETH or one ERC-20), to the one recipient
//! fixed at init. There is no owner, no setter and no upgrade method.
//!
//! The contract builds the EIP-1559 transaction itself. The caller supplies the
//! nonce, the fee parameters (capped at init) and the amount, and must restate
//! the chain id and recipient; any other chain, recipient or calldata is
//! refused before anything reaches the signer.
//!
//! What this does not do: it cannot see or prove what happens to the money
//! after it reaches the recipient. The recipient is a plain EVM address.

use near_sdk::json_types::U128;
use near_sdk::{env, near, require, AccountId, Gas, GasWeight, NearToken, PanicOnDefault, Promise};
use omni_transaction::evm::EVMTransaction;

/// Base Sepolia. Fixed in the code, not an init argument.
pub const CHAIN_ID: u64 = 84532;
/// The derivation path. With this account as the predecessor it fixes the EVM address.
pub const PATH: &str = "evm-1";
/// The MPC signer's secp256k1 domain.
pub const DOMAIN_ID: u32 = 0;
/// A plain ETH transfer costs exactly this much gas.
pub const NATIVE_GAS_LIMIT: u128 = 21_000;
/// Enough for a standard ERC-20 `transfer`.
pub const ERC20_GAS_LIMIT: u128 = 65_000;
/// `transfer(address,uint256)`
const ERC20_TRANSFER: [u8; 4] = [0xa9, 0x05, 0x9c, 0xbb];
/// The signer needs at least 10 Tgas; the rest of the call's gas is forwarded too.
const SIGN_GAS: Gas = Gas::from_tgas(15);

/// What a caller asks to have signed. `chain_id` and `to` must restate the
/// policy; `data` exists only so a request for a contract call can be refused
/// by name instead of silently ignored.
#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct TransferRequest {
    pub chain_id: u64,
    /// The recipient of the money (for ERC-20 too: the token contract is fixed by the policy).
    pub to: String,
    /// In wei, or in the token's smallest unit.
    pub amount: U128,
    pub nonce: u64,
    pub max_fee_per_gas: U128,
    pub max_priority_fee_per_gas: U128,
    #[serde(default)]
    pub data: Option<String>,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq)]
pub struct Policy {
    /// The Lien business whose revenue this vault holds. For display only.
    pub business: AccountId,
    /// The MPC signer contract.
    pub mpc: AccountId,
    pub chain_id: u64,
    /// The only address money can go to, lowercase `0x` hex.
    pub recipient: String,
    /// `None` for native ETH, or the ERC-20 contract, lowercase `0x` hex.
    pub token: Option<String>,
    /// The highest `max_fee_per_gas` the vault will sign, in wei.
    pub max_fee_per_gas_cap: U128,
}

#[near(serializers = [json])]
pub struct Unsigned {
    /// keccak256 of the EIP-2718 signing payload: what the MPC signer signs.
    pub payload: String,
    /// `0x02 || rlp([...])` without a signature.
    pub unsigned_tx: String,
}

#[near(serializers = [json])]
pub struct AddressPath {
    pub mpc: AccountId,
    pub predecessor: AccountId,
    pub path: String,
    pub domain_id: u32,
}

#[derive(PanicOnDefault)]
#[near(contract_state)]
pub struct XVault {
    policy: Policy,
}

#[near]
impl XVault {
    /// Sets the policy once. There is no method that changes it later.
    #[init]
    pub fn new(business: AccountId, mpc: AccountId, recipient: String, token: Option<String>, max_fee_per_gas_cap: U128) -> Self {
        let recipient = parse_address(&recipient, "recipient");
        require!(recipient != [0u8; 20], "the recipient cannot be the zero address");
        let token = token.map(|t| to_hex(&parse_address(&t, "token")));
        require!(max_fee_per_gas_cap.0 > 0, "the fee cap must be positive");
        Self {
            policy: Policy {
                business,
                mpc,
                chain_id: CHAIN_ID,
                recipient: to_hex(&recipient),
                token,
                max_fee_per_gas_cap,
            },
        }
    }

    pub fn policy(&self) -> Policy {
        self.policy.clone()
    }

    /// Everything needed to derive this vault's EVM address off chain, or to
    /// ask the signer's `derived_public_key` for it.
    pub fn evm_address_path(&self) -> AddressPath {
        AddressPath {
            mpc: self.policy.mpc.clone(),
            predecessor: env::current_account_id(),
            path: PATH.to_string(),
            domain_id: DOMAIN_ID,
        }
    }

    /// The exact transaction and payload `sign_transfer` would send to the
    /// signer, with the same checks. Free to call.
    pub fn build_transfer(&self, request: TransferRequest) -> Unsigned {
        let tx = self.checked_transaction(&request);
        let bytes = tx.build_for_signing();
        Unsigned { payload: to_hex(&env::keccak256_array(&bytes)), unsigned_tx: to_hex(&bytes) }
    }

    /// Asks the MPC signer to sign the policy's transfer. Anyone may call this:
    /// the money can only go to the recipient. Attach at least 1 yoctoNEAR
    /// (the signer's fee; any excess is refunded by the signer) and about 300 Tgas.
    /// The transaction's result is the signer's response.
    #[payable]
    pub fn sign_transfer(&mut self, request: TransferRequest) -> Promise {
        let deposit = env::attached_deposit();
        require!(deposit >= NearToken::from_yoctonear(1), "attach at least 1 yoctoNEAR for the signer");
        let tx = self.checked_transaction(&request);
        let bytes = tx.build_for_signing();
        let payload = env::keccak256_array(&bytes);
        let payload = hex::encode(payload);
        // Every interpolated value is hex, digits or a validated address, so plain formatting is valid JSON.
        env::log_str(&format!(
            r#"EVENT_JSON:{{"standard":"lien-xvault","version":"1.0.0","event":"sign_requested","data":[{{"chain_id":{CHAIN_ID},"to":"{}","amount":"{}","nonce":{},"payload":"{payload}","unsigned_tx":"{}"}}]}}"#,
            self.policy.recipient,
            request.amount.0,
            request.nonce,
            hex::encode(&bytes),
        ));
        let args = format!(r#"{{"request":{{"payload_v2":{{"Ecdsa":"{payload}"}},"path":"{PATH}","domain_id":{DOMAIN_ID}}}}}"#);
        Promise::new(self.policy.mpc.clone()).function_call_weight(
            "sign".to_string(),
            args.into_bytes(),
            deposit,
            SIGN_GAS,
            GasWeight(1),
        )
    }
}

impl XVault {
    /// Refuses anything outside the policy, then builds the only transaction
    /// the policy allows.
    fn checked_transaction(&self, r: &TransferRequest) -> EVMTransaction {
        let p = &self.policy;
        if r.chain_id != p.chain_id {
            env::panic_str(&format!("refused: chain id {} is not allowed, this vault signs only on Base Sepolia ({})", r.chain_id, p.chain_id));
        }
        let to = to_hex(&parse_address(&r.to, "to"));
        if to != p.recipient {
            env::panic_str(&format!("refused: {} is not the allowed recipient {}", to, p.recipient));
        }
        if let Some(data) = &r.data {
            let data = data.strip_prefix("0x").unwrap_or(data);
            if !data.is_empty() {
                env::panic_str("refused: contract calls are not allowed, this vault signs only plain transfers to its recipient");
            }
        }
        require!(r.amount.0 > 0, "refused: the amount must be positive");
        if r.max_fee_per_gas.0 > p.max_fee_per_gas_cap.0 {
            env::panic_str(&format!("refused: max_fee_per_gas {} is above the cap {}", r.max_fee_per_gas.0, p.max_fee_per_gas_cap.0));
        }
        require!(r.max_priority_fee_per_gas.0 <= r.max_fee_per_gas.0, "refused: the priority fee cannot exceed max_fee_per_gas");

        let recipient = parse_address(&p.recipient, "recipient");
        let (to, value, input, gas_limit) = match &p.token {
            None => (recipient, r.amount.0, Vec::new(), NATIVE_GAS_LIMIT),
            Some(token) => {
                let mut input = Vec::with_capacity(68);
                input.extend_from_slice(&ERC20_TRANSFER);
                input.extend_from_slice(&[0u8; 12]);
                input.extend_from_slice(&recipient);
                input.extend_from_slice(&[0u8; 16]);
                input.extend_from_slice(&r.amount.0.to_be_bytes());
                (parse_address(token, "token"), 0, input, ERC20_GAS_LIMIT)
            }
        };
        EVMTransaction {
            chain_id: p.chain_id,
            nonce: r.nonce,
            to: Some(to),
            value,
            input,
            gas_limit,
            max_fee_per_gas: r.max_fee_per_gas.0,
            max_priority_fee_per_gas: r.max_priority_fee_per_gas.0,
            access_list: vec![],
        }
    }
}

fn parse_address(value: &str, what: &str) -> [u8; 20] {
    let raw = value.strip_prefix("0x").unwrap_or(value);
    let bytes = hex::decode(raw).unwrap_or_else(|_| env::panic_str(&format!("{what} is not hex")));
    bytes.try_into().unwrap_or_else(|_| env::panic_str(&format!("{what} is not a 20-byte address")))
}

fn to_hex(bytes: &[u8]) -> String {
    format!("0x{}", hex::encode(bytes))
}

#[cfg(test)]
mod tests;
