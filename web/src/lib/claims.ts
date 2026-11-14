// Every promise Lien makes, each tied to the code that enforces it, the test that proves it
// and a real testnet transaction that shows it happening. The /proof page lists them all.

import { REPO_URL } from "./config";

const code = (path: string) => `${REPO_URL}/blob/main/${path}`;
const tx = (hash: string) => `https://testnet.nearblocks.io/txns/${hash}`;

export type Claim = {
  promise: string;
  plain: string;
  /** Which live check on the page proves it right now, if one does. */
  live?: "keys" | "code" | "build" | "ledger" | "enclave";
  tests: Array<{ name: string; href: string }>;
  evidence: Array<{ label: string; href: string }>;
};

const UNIT = "contracts/agent/src/tests.rs";
const SANDBOX = "tests/integration/tests/lifecycle.rs";

export const CLAIMS: Claim[] = [
  {
    promise: "Nobody can withdraw a business's money",
    plain: "Every business account has no keys at all, not even for its owner.",
    live: "keys",
    tests: [{ name: "a_created_business_has_no_keys_and_is_listed", href: code(`${SANDBOX}#L19`) }],
    evidence: [{ label: "A business created with no keys", href: tx("7zfvSeZ3idNUK1gxAtyP4hCLNLA4H1yAkNhT6SfdgUMc") }],
  },
  {
    promise: "Every business runs the same public contract",
    plain: "Its rules are the open-source Lien contract, matched byte for byte.",
    live: "code",
    tests: [{ name: "operator_cannot_change_the_code_during_a_loan", href: code(`${UNIT}#L396`) }],
    evidence: [{ label: "The contract source", href: code("contracts/agent/src/lib.rs") }],
  },
  {
    promise: "The owner can't take the loan",
    plain: "Borrowed money only pays approved suppliers, up to a daily limit, while the loan is open.",
    tests: [
      { name: "the_operator_cannot_reach_the_money_during_a_loan", href: code(`${SANDBOX}#L242`) },
      { name: "compromised_code_cannot_pay_anyone_outside_the_policy", href: code(`${SANDBOX}#L266`) },
    ],
    evidence: [{ label: "The refusals, recorded in the testnet run", href: code("docs/evidence/testnet-e2e.md") }],
  },
  {
    promise: "Every sale pays lenders first",
    plain: "The split is fixed in the loan's terms and runs the moment a sale is paid.",
    tests: [{ name: "revenue_splits_between_lenders_operator_and_opex", href: code(`${UNIT}#L462`) }],
    evidence: [{ label: "A sale that paid lenders first", href: tx("6NqUsdMC1iCdXTLVj65RofZU6pxwHvyV5onU6XvfWFMw") }],
  },
  {
    promise: "Its program is public, and its work runs sealed",
    plain: "The exact program is published, and each job runs on Intel TDX hardware that proves which program ran.",
    live: "enclave",
    tests: [],
    evidence: [
      { label: "The job that ran in TDX", href: tx("6NqUsdMC1iCdXTLVj65RofZU6pxwHvyV5onU6XvfWFMw") },
      { label: "Where the build is pinned", href: code("contracts/agent/src/jobs.rs") },
    ],
  },
  {
    promise: "Its books always balance",
    plain: "The money it holds always equals what it owes lenders, the owner, running costs and refunds.",
    live: "ledger",
    tests: [{ name: "property tests of the split and claims", href: code("contracts/agent/src/math.rs") }],
    evidence: [{ label: "End of the testnet run: ledger equals balance", href: code("docs/evidence/testnet-e2e.md") }],
  },
  {
    promise: "Income from any blockchain is split the same way",
    plain: "Money sent to a business's inbox goes through the same lenders-first split.",
    tests: [{ name: "money_sent_to_the_collector_runs_through_the_waterfall", href: code(`${SANDBOX}#L185`) }],
    evidence: [
      { label: "A transfer into the inbox", href: tx("GvgawbM3qSnm46BUBPCmW5zKFz5AGnYUczKDdhrEmGr8") },
      { label: "Forwarded through the split", href: tx("FuLZrQLM9kbTbtshXiirpH2xzXXzAqeQN7xc1dAbofzP") },
    ],
  },
  {
    promise: "Anyone can take over a business that stops paying",
    plain: "No company or keeper decides: once its extra time runs out, any account can take it over.",
    tests: [
      { name: "anyone_can_foreclose_after_grace_and_the_clock_needs_no_keeper", href: code(`${UNIT}#L594`) },
      { name: "cannot_foreclose_during_grace", href: code(`${UNIT}#L578`) },
    ],
    evidence: [{ label: "A stranger takes a business over", href: tx("74LFQQGHTSo9v7uLB8u6qgMR5UTqFXJMw1fgqPLN9a3g") }],
  },
  {
    promise: "A business that was taken over keeps earning for lenders",
    plain: "It keeps selling, and its owner's share goes to lenders until it is sold.",
    tests: [{ name: "a_foreclosed_business_keeps_earning_for_lenders", href: code(`${UNIT}#L617`) }],
    evidence: [{ label: "A sale after the takeover", href: tx("Aja18SN2rgSPrcni1i7Z62xgarwS91tMYsaaPYt6dktF") }],
  },
  {
    promise: "A sale pays lenders first and hands over control",
    plain: "The winning bid repays lenders before the old owner, and the buyer gets the business.",
    tests: [
      { name: "a_settled_sale_pays_lenders_and_hands_over_the_business", href: code(`${SANDBOX}#L346`) },
      { name: "a_late_bid_extends_the_auction_so_it_cannot_be_sniped", href: code(`${UNIT}#L758`) },
    ],
    evidence: [
      { label: "A bid", href: tx("3KHTnRxrW5RfRUVNvtCKAotv4Y6dFRTTYBtfgx6TKiwq") },
      { label: "The sale completed", href: tx("3smw9TPRdYZHNiTciP4gFMVnjRb5UYmRR1KSjF4k4nMf") },
      { label: "The new owner acts", href: tx("6oqKDRZsXon3igLyQ2qwo88gibsVPduy6YAuWwtzUGtL") },
    ],
  },
  {
    promise: "Code changes only with lenders' approval",
    plain: "During a loan, a new program needs lenders holding more than half the loan to agree, and votes can only tighten spending rules.",
    tests: [
      { name: "a_change_applies_only_when_more_than_half_of_principal_agrees", href: code(`${UNIT}#L1256`) },
      { name: "a_vote_cannot_add_a_vendor", href: code(`${UNIT}#L1358`) },
    ],
    evidence: [
      { label: "The owner proposes a new build", href: tx("9X2VEWuuNSmNfkwDyQRSKDyy48VthqZ2uQNNtVt7crmv") },
      { label: "The majority lender approves it", href: tx("5iG4UPPizMQvJuEkeT8yE4ChTC15KnvkagJzLMYSEyAg") },
    ],
  },
  {
    promise: "AI agents can use Lien without handing over a key",
    plain: "The MCP server prepares transactions; the agent signs them with its own key.",
    tests: [{ name: "mcp.test.ts", href: code("web/src/lib/mcp.test.ts") }],
    evidence: [{ label: "A lend built by the MCP server and signed by the lender", href: tx("Ekqhm3JQNbtoxqDTN37Q8nLWD8HxFWvudoajQLb3sV3D") }],
  },
];

export type Attack = {
  attack: string;
  /** What the contract does instead, in its own words where it has them. */
  result: string;
  tests: Array<{ name: string; href: string }>;
  /** Real testnet transactions only. When no refusal was recorded with a hash, this is empty
   *  and `note` says what the live run did record. */
  evidence: Array<{ label: string; href: string }>;
  note: string;
};

/** "Try to rob it": the three ways someone might take a business's money, each refused. */
export const ATTACKS: Attack[] = [
  {
    attack: "The operator tries to withdraw the business's money during a loan",
    result: "The contract answers \"not allowed while a loan is open\". The account has no keys to sign with either, so nobody can move its money by hand.",
    tests: [{ name: "the_operator_cannot_reach_the_money_during_a_loan", href: code(`${SANDBOX}#L242`) }],
    evidence: [
      { label: "Refused on testnet: the owner tries, during Sentinel's open loan", href: tx("AeFjMjMWmdzLeo3NcBw2EFcMqyg6CYSQG7DNRBtwKiXW") },
      { label: "Refused on testnet: a stranger tries", href: tx("51d7XBw8PS6P6uWQ4zs3k1TdZjZwxeehqEF2CnZPKAXQ") },
      { label: "The business was created with zero keys", href: tx("7zfvSeZ3idNUK1gxAtyP4hCLNLA4H1yAkNhT6SfdgUMc") },
    ],
    note: "Both attempts are real signed transactions that the contract refused. Anyone with a testnet account can try the same.",
  },
  {
    attack: "Compromised code tries to pay someone outside the spend policy",
    result: "The payment is not made, and the business counts it in spends_blocked. Only approved vendors, under per-payment and daily limits, can be paid.",
    tests: [
      { name: "compromised_code_cannot_pay_anyone_outside_the_policy", href: code(`${SANDBOX}#L266`) },
      { name: "compromised_code_cannot_pay_the_operator", href: code(`${UNIT}#L1124`) },
    ],
    evidence: [],
    note: "No blocked payment has happened on testnet, so this one is proven by the tests. The live run did make one payment inside the policy, to the approved vendor.",
  },
  {
    attack: "Someone swaps the code mid-loan without lender approval",
    result: "The contract answers \"not allowed while a loan is open\". During a loan, the only way to change the pinned build is a proposal that lenders holding more than half the loan approve.",
    tests: [
      { name: "operator_cannot_change_the_code_during_a_loan", href: code(`${UNIT}#L396`) },
      { name: "a_change_applies_only_when_more_than_half_of_principal_agrees", href: code(`${UNIT}#L1256`) },
    ],
    evidence: [
      { label: "Refused on testnet: the owner tries to swap the code mid-loan", href: tx("AMEa6hDvGLHqTVHfaiMTHp5Tu9sLnDLUEih2D3rdKjnj") },
      { label: "The way it did change on testnet: the owner proposes", href: tx("9X2VEWuuNSmNfkwDyQRSKDyy48VthqZ2uQNNtVt7crmv") },
      { label: "and the majority lender approves", href: tx("5iG4UPPizMQvJuEkeT8yE4ChTC15KnvkagJzLMYSEyAg") },
    ],
    note: "The refusal is a real signed transaction from the owner's account, rejected by the contract.",
  },
];
