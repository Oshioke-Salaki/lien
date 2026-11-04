// Mirrors the JSON returned by contracts/agent/src/views.rs.

export type LoanStatus = "Funding" | "Active" | "Repaid" | "Foreclosed" | "Sold" | "Cancelled";
export type JobStatus = "Pending" | "Done" | "Refunded";

export type SpendPolicy = { vendors: string[]; max_per_tx: string; max_per_day: string };

export type Service = {
  wasm: { url: string; hash: string; build_target: string };
  price: string;
  max_instructions: number;
  max_memory_mb: number;
  max_execution_seconds: number;
  compute_deposit: string;
  secrets_profile: string | null;
  policy: SpendPolicy;
};

export type LoanTerms = {
  principal: string;
  total_due: string;
  lender_bps: number;
  operator_bps: number;
  funding_secs: number;
  term_secs: number;
  window_secs: number;
  min_payment_per_window: string;
  grace_secs: number;
  auction_secs: number;
  auction_reserve_bps: number;
};

export type Auction = { high_bidder: string | null; high_bid: string; ends_at: number | null };

export type LoanView = {
  id: number;
  terms: LoanTerms;
  status: LoanStatus;
  created_at: number;
  funding_deadline: number;
  activated_at: number | null;
  funded: string;
  repaid: string;
  holders: number;
  foreclosed_at: number | null;
  closed_at: number | null;
  auction: Auction;
  outstanding: string;
  is_behind: boolean;
  breach_at: number | null;
  foreclosable_at: number | null;
  maturity: number | null;
  min_next_bid: string | null;
};

export type Ledger = {
  opex: string;
  operator: string;
  lender_pool: string;
  funding_escrow: string;
  job_escrow: string;
  auction_escrow: string;
  credits: string;
};

export type Stats = {
  jobs_done: number;
  jobs_refunded: number;
  unique_payers: number;
  job_revenue: string;
  external_revenue: string;
  spent: string;
  spends_blocked: number;
};

export type Proposal = {
  id: number;
  loan_id: number;
  service: Service;
  proposer: string;
  expires_at: number;
  approvals: string;
};

export type AgentView = {
  name: string;
  description: string;
  source_url: string;
  registry: string;
  token: string;
  outlayer: string;
  collector: string;
  operator: string;
  service: Service;
  ledger: Ledger;
  stats: Stats;
  tank: string;
  loan_count: number;
  current_loan: LoanView | null;
  proposal: Proposal | null;
  next_job_id: number;
  pending_jobs: number;
  spent_today: string;
  now: number;
};

export type Job = {
  id: number;
  payer: string;
  paid: string;
  input: string;
  status: JobStatus;
  report: string | null;
  created_at: number;
  wasm_hash: string;
};

export type NoteView = {
  principal: string;
  claimed: string;
  voted_proposal: number | null;
  claimable: string;
};

export type Report = {
  target: string;
  network: string;
  score: number;
  level: "low" | "medium" | "high";
  flags: string[];
  keys: [number, number];
  verdict?: string;
  verdict_error?: string;
};

export type Business = AgentView & { id: string };
