//! A keyless market for Lien loan shares ("notes").
//!
//! A buyer pays and receives the note in one transaction, or gets the money
//! back: neither side has to trust the other, and nobody has to trust this
//! contract's operator, because it has none. The account that runs it holds no
//! access keys, and there is no owner, setter or upgrade method.
//!
//! Selling takes three steps, in this order:
//! 1. `list(business, loan_id, price)`, from the seller, with a refundable bond.
//!    The market checks with the business's own `get_note` that the seller holds
//!    a note on that loan and that the market holds none. The seller's note
//!    principal is recorded. One listing per (business, loan) at a time.
//! 2. The seller calls `transfer_note(loan_id, market)` on the business.
//! 3. `confirm(business, loan_id)`, from anyone. The market checks that it now
//!    holds a note with exactly the recorded principal and that the seller holds
//!    none. Only then is the note for sale.
//!
//! Why this order: a business's `transfer_note` has no message or callback, so
//! the market cannot see who sent it a note. Reserving the listing first, with
//! a check that the market held nothing on that loan, ties the note that
//! arrives later to the seller who reserved it. Someone who sees the transfer
//! cannot list it for themselves, because the slot is already taken. Anyone who
//! sends a note here without listing it first gives it to whoever holds the
//! listing on that loan (or leaves it here for good, if there is none).
//!
//! Buying is one `ft_transfer_call` of exactly the price to this contract with
//! `msg = {"buy":{"business":...,"loan_id":...}}`. The market asks the business
//! to `transfer_note(loan_id, buyer)`. Only if that succeeds does it pay the
//! seller; if it fails, `ft_on_transfer` resolves to the full amount and the
//! token returns it to the buyer (NEP-141). While a sale or cancellation is in
//! flight the listing is locked, so a second buyer is refused and refunded.
//!
//! Repayments: a note carries everything it has earned and not claimed. This
//! market never claims, so whatever the note earned before and during the
//! listing goes to the buyer with the note. A seller who wants to keep what is
//! already claimable calls `claim` on the business before listing.
//!
//! Which businesses: only direct sub-accounts of the registry fixed at init
//! (`<label>.<registry>`), which is where the registry creates every Lien
//! business. A buyer still names the business and loan in their message.

use near_sdk::json_types::U128;
use near_sdk::serde::Deserialize;
use near_sdk::store::{IterableMap, LookupMap};
use near_sdk::{
    env, ext_contract, near, require, serde_json, AccountId, BorshStorageKey, Gas, NearToken, PanicOnDefault, Promise,
    PromiseOrValue,
};

/// Refundable deposit with every listing. Covers its storage many times over.
pub const LISTING_BOND: NearToken = NearToken::from_millinear(10);
/// After this long, anyone may cancel a listing the seller never confirmed,
/// so one lender cannot block the loan's slot forever.
pub const PENDING_TTL_NS: u64 = 3_600 * 1_000_000_000;
const ONE_YOCTO: NearToken = NearToken::from_yoctonear(1);
const GAS_VIEW: Gas = Gas::from_tgas(10);
const GAS_TRANSFER_NOTE: Gas = Gas::from_tgas(20);
const GAS_FT_TRANSFER: Gas = Gas::from_tgas(15);
const GAS_ON_PAID: Gas = Gas::from_tgas(10);
const GAS_CHECK: Gas = Gas::from_tgas(15);
const GAS_ON_BOUGHT: Gas = Gas::from_tgas(50);
const GAS_ON_CANCEL_CHECKED: Gas = Gas::from_tgas(50);
const GAS_ON_CANCELLED: Gas = Gas::from_tgas(15);
const MAX_RESULT_LEN: usize = 4_096;

#[ext_contract(ext_business)]
#[allow(dead_code)]
trait Business {
    fn get_note(&self, loan_id: u32, account_id: AccountId) -> Option<NoteInfo>;
    fn transfer_note(&mut self, loan_id: u32, to: AccountId);
}

#[ext_contract(ext_ft)]
#[allow(dead_code)]
trait FungibleToken {
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>);
}

/// The part of a business's `get_note` answer the market reads.
#[derive(Deserialize, Debug, Clone)]
#[serde(crate = "near_sdk::serde")]
pub struct NoteInfo {
    pub principal: U128,
}

#[derive(BorshStorageKey)]
#[near]
enum StorageKey {
    Listings,
    Credits,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Status {
    /// Reserved by the seller; the note has not been confirmed here yet.
    Pending,
    /// The market holds the note; anyone may buy it for the price.
    ForSale,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Listing {
    pub business: AccountId,
    pub loan_id: u32,
    pub seller: AccountId,
    /// In the token's smallest unit.
    pub price: U128,
    /// The note's principal, as the business reported it when the seller listed.
    pub principal: U128,
    pub bond: NearToken,
    pub status: Status,
    /// True while a check, sale or cancellation is waiting on the business.
    pub busy: bool,
    pub listed_at: u64,
}

#[near(serializers = [json])]
pub struct Config {
    pub token: AccountId,
    pub registry: AccountId,
    pub listing_bond: NearToken,
    pub pending_ttl_ns: u64,
}

#[derive(Deserialize)]
#[serde(crate = "near_sdk::serde", rename_all = "snake_case", deny_unknown_fields)]
enum TransferMsg {
    Buy { business: AccountId, loan_id: u32 },
}

type Key = (AccountId, u32);

#[derive(PanicOnDefault)]
#[near(contract_state)]
pub struct NoteMarket {
    token: AccountId,
    registry: AccountId,
    listings: IterableMap<Key, Listing>,
    /// Seller payouts the token refused (for example, an unregistered seller).
    /// Anyone can retry them with `withdraw`.
    credits: LookupMap<AccountId, U128>,
}

#[near]
impl NoteMarket {
    /// Fixes the payment token and the registry whose businesses can be traded.
    /// Nothing can change them later.
    #[init]
    pub fn new(token: AccountId, registry: AccountId) -> Self {
        Self {
            token,
            registry,
            listings: IterableMap::new(StorageKey::Listings),
            credits: LookupMap::new(StorageKey::Credits),
        }
    }

    // ---------- selling ----------

    /// Reserves a listing for the caller's note. Attach at least the listing
    /// bond (0.01 NEAR); all of it comes back on sale or cancellation.
    /// Then move the whole note here with `transfer_note` and call `confirm`.
    #[payable]
    pub fn list(&mut self, business: AccountId, loan_id: u32, price: U128) -> Promise {
        let bond = env::attached_deposit();
        require!(bond >= LISTING_BOND, "attach at least 0.01 NEAR as a listing bond; it is returned");
        require!(price.0 > 0, "the price must be positive");
        self.assert_business(&business);
        let key = (business.clone(), loan_id);
        require!(self.listings.get(&key).is_none(), "this loan already has a listing; one at a time");
        let seller = env::predecessor_account_id();
        self.listings.insert(
            key,
            Listing {
                business: business.clone(),
                loan_id,
                seller: seller.clone(),
                price,
                principal: U128(0),
                bond,
                status: Status::Pending,
                busy: true,
                listed_at: env::block_timestamp(),
            },
        );
        ext_business::ext(business.clone())
            .with_static_gas(GAS_VIEW)
            .get_note(loan_id, seller)
            .and(ext_business::ext(business.clone()).with_static_gas(GAS_VIEW).get_note(loan_id, env::current_account_id()))
            .then(Self::ext(env::current_account_id()).with_static_gas(GAS_CHECK).on_list_checked(business, loan_id))
    }

    /// Keeps the reservation only if the seller holds a note and the market
    /// holds none on that loan; otherwise drops it and returns the bond.
    #[private]
    pub fn on_list_checked(&mut self, business: AccountId, loan_id: u32) -> bool {
        let key = (business, loan_id);
        let Some(mut listing) = self.listings.get(&key).cloned() else { return false };
        let reason = match (note_result(0), note_result(1)) {
            (Ok(Some(seller)), Ok(None)) if seller.principal.0 > 0 => {
                listing.principal = seller.principal;
                listing.busy = false;
                self.listings.insert(key, listing.clone());
                event("listed", &listing);
                return true;
            }
            (Err(_), _) | (_, Err(_)) => "the business did not answer get_note",
            (Ok(None), _) | (Ok(Some(_)), Ok(None)) => "the seller holds no note on that loan",
            (_, Ok(Some(_))) => "the market already holds a note on that loan",
        };
        env::log_str(&format!("not listed: {reason}"));
        self.listings.remove(&key);
        Promise::new(listing.seller).transfer(listing.bond).detach();
        false
    }

    /// Puts a reserved note up for sale once the market holds it. Anyone may
    /// call this; it only checks.
    pub fn confirm(&mut self, business: AccountId, loan_id: u32) -> Promise {
        let key = (business.clone(), loan_id);
        let listing = self.listings.get_mut(&key).unwrap_or_else(|| env::panic_str("that note is not listed"));
        require!(listing.status == Status::Pending, "already for sale");
        require!(!listing.busy, "this listing is busy; try again in a moment");
        listing.busy = true;
        let seller = listing.seller.clone();
        ext_business::ext(business.clone())
            .with_static_gas(GAS_VIEW)
            .get_note(loan_id, env::current_account_id())
            .and(ext_business::ext(business.clone()).with_static_gas(GAS_VIEW).get_note(loan_id, seller))
            .then(Self::ext(env::current_account_id()).with_static_gas(GAS_CHECK).on_confirmed(business, loan_id))
    }

    /// For sale only if the market holds exactly the listed principal and the
    /// seller no longer holds a note on that loan.
    #[private]
    pub fn on_confirmed(&mut self, business: AccountId, loan_id: u32) -> bool {
        let key = (business, loan_id);
        let Some(listing) = self.listings.get_mut(&key) else { return false };
        listing.busy = false;
        match (note_result(0), note_result(1)) {
            (Ok(Some(held)), Ok(None)) if held.principal == listing.principal => {
                listing.status = Status::ForSale;
                let listing = listing.clone();
                event("for_sale", &listing);
                true
            }
            _ => {
                env::log_str("not confirmed: the market does not hold the seller's whole note yet");
                false
            }
        }
    }

    /// Takes the listing down and returns the note (if the market holds it)
    /// and the bond to the seller. Only the seller, except that anyone may
    /// clear a listing that stayed unconfirmed for an hour. Attach 1 yoctoNEAR.
    #[payable]
    pub fn cancel(&mut self, business: AccountId, loan_id: u32) -> Promise {
        require!(env::attached_deposit() == ONE_YOCTO, "attach exactly 1 yoctoNEAR");
        let key = (business.clone(), loan_id);
        let listing = self.listings.get_mut(&key).unwrap_or_else(|| env::panic_str("that note is not listed"));
        require!(!listing.busy, "this listing is busy; try again in a moment");
        let stale = listing.status == Status::Pending && env::block_timestamp() >= listing.listed_at + PENDING_TTL_NS;
        require!(
            env::predecessor_account_id() == listing.seller || stale,
            "only the seller can cancel (anyone can, an hour after an unconfirmed listing)"
        );
        listing.busy = true;
        ext_business::ext(business.clone())
            .with_static_gas(GAS_VIEW)
            .get_note(loan_id, env::current_account_id())
            .then(Self::ext(env::current_account_id()).with_static_gas(GAS_ON_CANCEL_CHECKED).on_cancel_checked(business, loan_id))
    }

    #[private]
    pub fn on_cancel_checked(&mut self, business: AccountId, loan_id: u32) -> PromiseOrValue<bool> {
        let key = (business.clone(), loan_id);
        let Some(listing) = self.listings.get_mut(&key) else { return PromiseOrValue::Value(false) };
        match note_result(0) {
            Ok(None) => {
                // Nothing here to return: the seller never delivered.
                let listing = self.listings.remove(&key).unwrap();
                Promise::new(listing.seller.clone()).transfer(listing.bond).detach();
                event("cancelled", &listing);
                PromiseOrValue::Value(true)
            }
            Ok(Some(_)) => {
                let seller = listing.seller.clone();
                PromiseOrValue::Promise(
                    ext_business::ext(business.clone())
                        .with_attached_deposit(ONE_YOCTO)
                        .with_static_gas(GAS_TRANSFER_NOTE)
                        .transfer_note(loan_id, seller)
                        .then(Self::ext(env::current_account_id()).with_static_gas(GAS_ON_CANCELLED).on_cancelled(business, loan_id)),
                )
            }
            Err(_) => {
                listing.busy = false;
                env::log_str("not cancelled: the business did not answer get_note");
                PromiseOrValue::Value(false)
            }
        }
    }

    /// The listing ends only once the note is back with the seller.
    #[private]
    pub fn on_cancelled(&mut self, business: AccountId, loan_id: u32) -> bool {
        let key = (business, loan_id);
        let Some(listing) = self.listings.get_mut(&key) else { return false };
        if succeeded(0) {
            let listing = self.listings.remove(&key).unwrap();
            Promise::new(listing.seller.clone()).transfer(listing.bond).detach();
            event("cancelled", &listing);
            true
        } else {
            listing.busy = false;
            env::log_str("not cancelled: the business refused to return the note; it is still listed");
            false
        }
    }

    // ---------- buying ----------

    /// NEP-141 receiver. `msg` is `{"buy":{"business":"...","loan_id":N}}` and
    /// the amount must equal the price. A panic here makes the token refund the
    /// buyer in full; once the note transfer is under way, the callback decides.
    pub fn ft_on_transfer(&mut self, sender_id: AccountId, amount: U128, msg: String) -> PromiseOrValue<U128> {
        require!(env::predecessor_account_id() == self.token, format!("only {} is accepted", self.token));
        let TransferMsg::Buy { business, loan_id } = serde_json::from_str(&msg)
            .unwrap_or_else(|_| env::panic_str(r#"msg must be {"buy":{"business":"...","loan_id":N}}"#));
        let key = (business.clone(), loan_id);
        let listing = self.listings.get_mut(&key).unwrap_or_else(|| env::panic_str("that note is not listed"));
        require!(listing.status == Status::ForSale, "that note is not for sale yet");
        require!(!listing.busy, "a sale or cancellation of this note is in progress");
        require!(sender_id != listing.seller, "this is your own listing; cancel it instead");
        require!(amount == listing.price, format!("the price is {}", listing.price.0));
        listing.busy = true;
        PromiseOrValue::Promise(
            ext_business::ext(business.clone())
                .with_attached_deposit(ONE_YOCTO)
                .with_static_gas(GAS_TRANSFER_NOTE)
                .transfer_note(loan_id, sender_id.clone())
                .then(Self::ext(env::current_account_id()).with_static_gas(GAS_ON_BOUGHT).on_bought(business, loan_id, sender_id, amount)),
        )
    }

    /// Pays the seller only if the note reached the buyer. Returns what the
    /// token should give back to the buyer: nothing, or everything.
    #[private]
    pub fn on_bought(&mut self, business: AccountId, loan_id: u32, buyer: AccountId, amount: U128) -> U128 {
        let key = (business, loan_id);
        let Some(listing) = self.listings.get_mut(&key) else { return amount };
        if !succeeded(0) {
            listing.busy = false;
            env::log_str("the note did not move; the buyer is refunded and the note stays listed");
            return amount;
        }
        let listing = self.listings.remove(&key).unwrap();
        self.pay(listing.seller.clone(), amount);
        Promise::new(listing.seller.clone()).transfer(listing.bond).detach();
        env::log_str(&format!(
            r#"EVENT_JSON:{{"standard":"lien-notemarket","version":"1.0.0","event":"sold","data":[{{"business":"{}","loan_id":{},"seller":"{}","buyer":"{}","price":"{}","principal":"{}"}}]}}"#,
            listing.business, listing.loan_id, listing.seller, buyer, amount.0, listing.principal.0
        ));
        U128(0)
    }

    /// Restores a seller's payout as a credit if the token refused it.
    #[private]
    pub fn on_paid(&mut self, account_id: AccountId, amount: U128) {
        if !succeeded(0) {
            let owed = self.credits.get(&account_id).map_or(0, |c| c.0);
            self.credits.insert(account_id.clone(), U128(owed + amount.0));
            env::log_str(&format!("payout of {} to {account_id} failed; kept as a credit, retry with withdraw", amount.0));
        }
    }

    /// Retries a refused payout. Anyone may call it; the money only goes to `account_id`.
    pub fn withdraw(&mut self, account_id: AccountId) {
        let amount = self.credits.remove(&account_id).unwrap_or_else(|| env::panic_str("nothing to withdraw"));
        self.pay(account_id, amount);
    }

    // ---------- views ----------

    pub fn get_listing(&self, business: AccountId, loan_id: u32) -> Option<Listing> {
        self.listings.get(&(business, loan_id)).cloned()
    }

    /// All listings, pending and for sale.
    pub fn get_listings(&self, from_index: Option<u32>, limit: Option<u32>) -> Vec<Listing> {
        self.listings
            .values()
            .skip(from_index.unwrap_or(0) as usize)
            .take(limit.unwrap_or(50).min(100) as usize)
            .cloned()
            .collect()
    }

    pub fn get_credit(&self, account_id: AccountId) -> U128 {
        self.credits.get(&account_id).copied().unwrap_or(U128(0))
    }

    pub fn get_config(&self) -> Config {
        Config {
            token: self.token.clone(),
            registry: self.registry.clone(),
            listing_bond: LISTING_BOND,
            pending_ttl_ns: PENDING_TTL_NS,
        }
    }
}

impl NoteMarket {
    fn assert_business(&self, business: &AccountId) {
        let label = business.as_str().strip_suffix(&format!(".{}", self.registry));
        require!(
            label.is_some_and(|l| !l.is_empty() && !l.contains('.')) && business != &env::current_account_id(),
            format!("not a Lien business: businesses are accounts directly under {}", self.registry)
        );
    }

    fn pay(&self, account_id: AccountId, amount: U128) {
        ext_ft::ext(self.token.clone())
            .with_attached_deposit(ONE_YOCTO)
            .with_static_gas(GAS_FT_TRANSFER)
            .ft_transfer(account_id.clone(), amount, Some("Lien note sale".to_string()))
            .then(Self::ext(env::current_account_id()).with_static_gas(GAS_ON_PAID).on_paid(account_id, amount))
            .detach();
    }
}

fn succeeded(index: u64) -> bool {
    env::promise_result_checked(index, MAX_RESULT_LEN).is_ok()
}

fn note_result(index: u64) -> Result<Option<NoteInfo>, ()> {
    let bytes = env::promise_result_checked(index, MAX_RESULT_LEN).map_err(|_| ())?;
    serde_json::from_slice(&bytes).map_err(|_| ())
}

fn event(name: &str, l: &Listing) {
    env::log_str(&format!(
        r#"EVENT_JSON:{{"standard":"lien-notemarket","version":"1.0.0","event":"{name}","data":[{{"business":"{}","loan_id":{},"seller":"{}","price":"{}","principal":"{}"}}]}}"#,
        l.business, l.loan_id, l.seller, l.price.0, l.principal.0
    ));
}

#[cfg(test)]
mod tests;
