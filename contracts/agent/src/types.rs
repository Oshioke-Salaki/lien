use near_sdk::json_types::U128;
use near_sdk::{near, AccountId, NearToken};

/// The exact build the business runs. OutLayer refuses bytes whose SHA-256
/// differs from `hash`, so pinning this pins the agent's behaviour.
#[derive(Clone, Debug, PartialEq)]
#[near(serializers = [borsh, json])]
pub struct WasmSource {
    pub url: String,
    pub hash: String,
    pub build_target: String,
}

/// Which accounts the agent's code may pay, and how fast.
#[derive(Clone, Debug, PartialEq)]
#[near(serializers = [borsh, json])]
pub struct SpendPolicy {
    pub vendors: Vec<AccountId>,
    pub max_per_tx: U128,
    pub max_per_day: U128,
}

/// Everything a lender underwrites about how the business operates. Frozen for
/// the life of a loan unless noteholders vote to change it.
#[derive(Clone, Debug, PartialEq)]
#[near(serializers = [borsh, json])]
pub struct Service {
    pub wasm: WasmSource,
    /// Price of one job, in token units.
    pub price: U128,
    pub max_instructions: u64,
    pub max_memory_mb: u32,
    pub max_execution_seconds: u64,
    /// NEAR attached to each OutLayer run. The unused part is refunded here.
    pub compute_deposit: NearToken,
    /// OutLayer secrets row owned by this account, if the code needs secrets.
    pub secrets_profile: Option<String>,
    pub policy: SpendPolicy,
}

#[derive(Clone, Debug, PartialEq)]
#[near(serializers = [borsh, json])]
pub struct LoanTerms {
    pub principal: U128,
    /// Principal plus interest. Lenders receive this at most.
    pub total_due: U128,
    pub lender_bps: u16,
    pub operator_bps: u16,
    pub funding_secs: u64,
    pub term_secs: u64,
    pub window_secs: u64,
    pub min_payment_per_window: U128,
    pub grace_secs: u64,
    pub auction_secs: u64,
    /// Lowest first bid, as a share of the debt outstanding at bid time.
    pub auction_reserve_bps: u16,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[near(serializers = [borsh, json])]
pub enum LoanStatus {
    Funding,
    Active,
    Repaid,
    Foreclosed,
    Sold,
    Cancelled,
}

#[derive(Clone, Debug, PartialEq, Default)]
#[near(serializers = [borsh, json])]
pub struct Auction {
    pub high_bidder: Option<AccountId>,
    pub high_bid: U128,
    pub ends_at: Option<u64>,
}

#[derive(Clone, Debug, PartialEq)]
#[near(serializers = [borsh, json])]
pub struct Loan {
    pub id: u32,
    pub terms: LoanTerms,
    /// The service lenders agreed to, so history shows what was underwritten.
    pub status: LoanStatus,
    pub created_at: u64,
    pub funding_deadline: u64,
    pub activated_at: Option<u64>,
    pub funded: U128,
    /// Total ever paid to lenders on this loan.
    pub repaid: U128,
    pub holders: u32,
    pub foreclosed_at: Option<u64>,
    pub closed_at: Option<u64>,
    pub auction: Auction,
}

#[derive(Clone, Debug, PartialEq, Default)]
#[near(serializers = [borsh, json])]
pub struct Note {
    pub principal: U128,
    pub claimed: U128,
    /// Last change proposal this note voted on. Blocks a transfer while that
    /// proposal is open, so the same principal cannot vote twice.
    pub voted_proposal: Option<u32>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[near(serializers = [borsh, json])]
pub enum JobStatus {
    Pending,
    Done,
    Refunded,
}

#[derive(Clone, Debug, PartialEq)]
#[near(serializers = [borsh, json])]
pub struct Job {
    pub id: u64,
    pub payer: AccountId,
    pub paid: U128,
    pub input: String,
    pub status: JobStatus,
    pub report: Option<String>,
    pub created_at: u64,
    /// The build that ran, so a report can be matched to its attestation.
    pub wasm_hash: String,
}

/// A proposed change to the frozen service, decided by noteholders.
#[derive(Clone, Debug, PartialEq)]
#[near(serializers = [borsh, json])]
pub struct Proposal {
    pub id: u32,
    pub loan_id: u32,
    pub service: Service,
    pub proposer: AccountId,
    pub expires_at: u64,
    pub approvals: U128,
}

/// Where every token held by this contract is accounted for. The sum of these
/// never exceeds the contract's token balance.
#[derive(Clone, Debug, PartialEq, Default)]
#[near(serializers = [borsh, json])]
pub struct Ledger {
    /// Working capital. Only the agent's code can spend it during a loan.
    pub opex: U128,
    /// The operator's earned share.
    pub operator: U128,
    /// Paid to lenders and not yet claimed, across all loans.
    pub lender_pool: U128,
    /// Lender money held until a loan is fully funded or cancelled.
    pub funding_escrow: U128,
    /// Customer payments held until their job finishes.
    pub job_escrow: U128,
    /// The current high bid.
    pub auction_escrow: U128,
    /// Owed to specific accounts and being paid out.
    pub credits: U128,
}

impl Ledger {
    pub fn total(&self) -> u128 {
        self.opex.0
            + self.operator.0
            + self.lender_pool.0
            + self.funding_escrow.0
            + self.job_escrow.0
            + self.auction_escrow.0
            + self.credits.0
    }
}

/// Lifetime counters a lender can read before funding. These are facts about
/// the chain, not claims by the operator.
#[derive(Clone, Debug, PartialEq, Default)]
#[near(serializers = [borsh, json])]
pub struct Stats {
    pub jobs_done: u64,
    pub jobs_refunded: u64,
    pub unique_payers: u64,
    pub job_revenue: U128,
    pub external_revenue: U128,
    pub spent: U128,
    pub spends_blocked: u64,
}
