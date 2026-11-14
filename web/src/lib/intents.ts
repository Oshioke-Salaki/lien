// Paying a business from another chain through NEAR Intents' 1Click API
// (https://docs.near-intents.org/integration/distribution-channels/1click-api/quickstart/making-a-request).
//
// The flow: POST /v0/quote returns a deposit address on the payer's chain; the payer sends to it;
// GET /v0/status?depositAddress=… then moves through PENDING_DEPOSIT → KNOWN_DEPOSIT_TX →
// PROCESSING → SUCCESS, or ends in INCOMPLETE_DEPOSIT, REFUNDED or FAILED. On SUCCESS the USDC
// lands at the business's payment address (its collector), and anyone can split it into the
// lenders-first waterfall. No custodian: 1Click holds nothing on Lien's behalf.
//
// Pure functions only, so the request and the wording are unit tested (intents.test.ts).

export const ONECLICK_API = "https://1click.chaindefuser.com/v0";
/** USDC on NEAR mainnet: what the business is paid in. */
export const USDC_NEAR = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";

const NEAR_ACCOUNT = /^(?=.{2,64}$)[a-z0-9]+([-_][a-z0-9]+)*(\.[a-z0-9]+([-_][a-z0-9]+)*)*$/;
const ASSET = /^nep\d+:[\w.\-:]+$/;
const EVM = /^0x[0-9a-f]{40}$/i;
const ADDRESS = /^[\w.:\-]{2,128}$/;

/** Headers for 1Click. The partner JWT is optional: without it, 1Click still quotes, with its unauthenticated fee. */
export const oneClickHeaders = (jwt?: string): Record<string, string> => ({
  "content-type": "application/json",
  ...(jwt ? { "x-api-key": jwt } : {}),
});

export type QuoteInput = {
  originAsset?: unknown;
  /** USDC the business should receive, in 6-decimal base units. */
  amount?: unknown;
  refundTo?: unknown;
  /** The business's payment address (its collector account). */
  recipient?: unknown;
  /** A dry quote is a price only: 1Click returns no deposit address and nothing can be sent. */
  dry?: unknown;
};

export type QuoteRequest = {
  dry: boolean;
  swapType: "EXACT_OUTPUT";
  slippageTolerance: number;
  originAsset: string;
  depositType: "ORIGIN_CHAIN";
  destinationAsset: string;
  amount: string;
  refundTo: string;
  refundType: "ORIGIN_CHAIN";
  recipient: string;
  recipientType: "DESTINATION_CHAIN" | "INTENTS";
  deadline: string;
};

/** The chains 1Click's asset ids name (nep141:base-0x…omft.near), in words. */
const CHAINS: Record<string, { name: string; format: "evm" | "sol" }> = {
  eth: { name: "Ethereum", format: "evm" }, base: { name: "Base", format: "evm" }, arb: { name: "Arbitrum", format: "evm" },
  op: { name: "Optimism", format: "evm" }, pol: { name: "Polygon", format: "evm" }, bsc: { name: "BNB Chain", format: "evm" },
  gnosis: { name: "Gnosis", format: "evm" }, avax: { name: "Avalanche", format: "evm" }, sol: { name: "Solana", format: "sol" },
};

/** The chain an asset id lives on, if the app knows its address format. */
export function chainOf(assetId: string): { name: string; format: "evm" | "sol" } | null {
  const m = /^nep\d+:([a-z]+)-/.exec(assetId);
  return (m && CHAINS[m[1]!]) || null;
}

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/**
 * Why a refund address cannot be right for the chain being paid from, or null if it can be.
 * EVM chains: 0x and 40 hex digits, in any letter case (checksummed or not). Solana: a base58
 * address. Other chains: a loose shape check, and 1Click has the last word.
 */
export function refundProblem(address: string, assetId: string): string | null {
  const chain = chainOf(assetId);
  const a = address.trim();
  if (!a) return "Enter your address on that chain, so a failed payment can come back to you.";
  if (chain?.format === "evm") return EVM.test(a) ? null : `That does not look right for a ${chain.name} address: it starts with 0x, then 40 letters and digits (0-9 and a-f, any case).`;
  if (chain?.format === "sol") return BASE58.test(a) ? null : "That does not look right for a Solana address: 32 to 44 letters and digits, with no 0x.";
  return ADDRESS.test(a) ? null : "That refund address does not look right for this chain.";
}

/** A well-formed address that stands in for an empty refund address in a preview, which sends nothing. */
export function previewRefund(assetId: string): string | null {
  const chain = chainOf(assetId);
  if (chain?.format === "evm") return "0x1111111111111111111111111111111111111111";
  if (chain?.format === "sol") return "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";
  return null;
}

export type BuildResult ={ ok: true; request: QuoteRequest } | { ok: false; error: string };

/**
 * The 1Click quote request for "this business receives `amount` USDC, paid from `originAsset`".
 *
 * On mainnet the USDC is delivered on NEAR to the business's collector (DESTINATION_CHAIN), where the
 * contract splits it. Lien runs on testnet, whose collector names (`*.testnet`) do not exist on
 * mainnet, so 1Click rejects them as a NEAR destination; there the quote credits the same name inside
 * the Intents ledger (INTENTS), which mainnet 1Click accepts, so the deposit address and status flow
 * are real. Sending is switched off in the app on testnet: that balance could never reach the
 * testnet business.
 */
export function buildQuoteRequest(input: QuoteInput, opts: { mainnet: boolean; now: number }): BuildResult {
  const { originAsset, amount, refundTo, recipient } = input;
  if (typeof originAsset !== "string" || !ASSET.test(originAsset)) return { ok: false, error: "Pick a currency to pay with." };
  if (typeof amount !== "string" || !/^\d{1,30}$/.test(amount) || BigInt(amount) === 0n) return { ok: false, error: "Check the amount." };
  if (typeof recipient !== "string" || !NEAR_ACCOUNT.test(recipient)) return { ok: false, error: "This business has no valid payment address." };
  const typed = typeof refundTo === "string" ? refundTo.trim() : "";
  // A preview (dry quote) creates no deposit address, so nothing can ever be refunded: it may leave
  // the refund address empty, and a well-formed placeholder for the chain stands in for 1Click.
  const refund = !typed && input.dry === true ? previewRefund(originAsset) ?? "" : typed;
  const problem = refundProblem(refund, originAsset);
  if (problem) return { ok: false, error: problem };
  return {
    ok: true,
    request: {
      dry: input.dry === true,
      swapType: "EXACT_OUTPUT",
      slippageTolerance: 100,
      originAsset,
      depositType: "ORIGIN_CHAIN",
      destinationAsset: USDC_NEAR,
      amount,
      // EVM addresses are accepted in any letter case; the route API wants them in one.
      refundTo: EVM.test(refund) ? refund.toLowerCase() : refund,
      refundType: "ORIGIN_CHAIN",
      recipient,
      recipientType: opts.mainnet ? "DESTINATION_CHAIN" : "INTENTS",
      deadline: new Date(opts.now + 60 * 60 * 1000).toISOString(),
    },
  };
}

/** The parts of a 1Click quote the app shows. */
export type QuoteView = {
  dry: boolean;
  amountIn: string;
  amountInFormatted: string;
  amountOutFormatted: string;
  timeEstimate: number;
  depositAddress: string | null;
  depositMemo: string | null;
  /** When 1Click stops watching the deposit address. */
  deadline: string | null;
  recipient: string;
  recipientType: QuoteRequest["recipientType"];
  refundTo: string;
};

type RawQuote = {
  amountIn?: string; amountInFormatted?: string; amountOutFormatted?: string; timeEstimate?: number;
  depositAddress?: string; depositMemo?: string; deadline?: string; timeWhenInactive?: string;
};

export function readQuote(request: QuoteRequest, data: unknown): QuoteView | null {
  const quote = (data as { quote?: RawQuote } | null)?.quote;
  if (!quote?.amountInFormatted) return null;
  return {
    dry: request.dry,
    amountIn: quote.amountIn ?? "",
    amountInFormatted: quote.amountInFormatted,
    amountOutFormatted: quote.amountOutFormatted ?? "",
    timeEstimate: Number(quote.timeEstimate ?? 0),
    depositAddress: request.dry ? null : quote.depositAddress ?? null,
    depositMemo: request.dry ? null : quote.depositMemo ?? null,
    deadline: quote.timeWhenInactive ?? quote.deadline ?? null,
    recipient: request.recipient,
    recipientType: request.recipientType,
    refundTo: request.refundTo,
  };
}

/** 1Click's error text, in words a customer can act on. */
export function friendlyQuoteError(message: string | undefined): string {
  const m = message ?? "";
  // The shape was already checked (refundProblem), so 1Click is refusing this particular address.
  if (/refundTo/i.test(m)) return "NEAR Intents would not take this refund address. It has the right shape, but 1Click refuses some addresses, such as the 0x…dEaD burn address. Use an address you control.";
  if (/amount.*(too low|small|minimum)/i.test(m)) return "That amount is below the smallest payment this route accepts. Try a larger amount.";
  if (/recipient/i.test(m)) return "NEAR Intents would not accept this business's payment address.";
  return m && m !== "Internal server error" ? m : "No route is available right now.";
}

// ---- status ----

export const INTENT_STATUSES = ["PENDING_DEPOSIT", "KNOWN_DEPOSIT_TX", "PROCESSING", "SUCCESS", "INCOMPLETE_DEPOSIT", "REFUNDED", "FAILED"] as const;
export type IntentStatus = (typeof INTENT_STATUSES)[number];

export const isIntentStatus = (s: unknown): s is IntentStatus => typeof s === "string" && (INTENT_STATUSES as readonly string[]).includes(s);

/** Statuses after which nothing more will happen to this deposit. */
export const isFinalStatus = (s: IntentStatus) => s === "SUCCESS" || s === "REFUNDED" || s === "FAILED";

/** The status response, trimmed to what the app shows. */
export type StatusView = {
  status: IntentStatus | "UNKNOWN";
  rawStatus: string;
  updatedAt: string | null;
  depositedFormatted: string | null;
  amountOutFormatted: string | null;
  refundedFormatted: string | null;
  refundReason: string | null;
  originTxs: string[];
  destinationTxs: string[];
};

type RawStatus = {
  status?: string;
  updatedAt?: string;
  swapDetails?: {
    depositedAmountFormatted?: string | null; amountOutFormatted?: string | null; refundedAmountFormatted?: string | null;
    refundReason?: string | null; originChainTxHashes?: Array<{ hash?: string } | string>; destinationChainTxHashes?: Array<{ hash?: string } | string>;
  };
};

const hashes = (list: Array<{ hash?: string } | string> | undefined) =>
  (list ?? []).map((h) => (typeof h === "string" ? h : h?.hash ?? "")).filter(Boolean);
const nonZero = (v: string | null | undefined) => (v && Number(v) !== 0 ? v : null);

export function readStatus(data: unknown): StatusView {
  const d = (data ?? {}) as RawStatus;
  const raw = typeof d.status === "string" ? d.status : "";
  const s = d.swapDetails ?? {};
  return {
    status: isIntentStatus(raw) ? raw : "UNKNOWN",
    rawStatus: raw,
    updatedAt: d.updatedAt ?? null,
    depositedFormatted: nonZero(s.depositedAmountFormatted),
    amountOutFormatted: nonZero(s.amountOutFormatted),
    refundedFormatted: nonZero(s.refundedAmountFormatted),
    refundReason: s.refundReason ?? null,
    originTxs: hashes(s.originChainTxHashes),
    destinationTxs: hashes(s.destinationChainTxHashes),
  };
}

export type StatusTone = "waiting" | "done" | "attention" | "bad";

export type StatusWords = {
  /** Short label, e.g. for a chip. */
  label: string;
  /** What it means for the customer, in plain words. */
  meaning: string;
  tone: StatusTone;
  final: boolean;
};

export type StatusContext = {
  /** What the customer was quoted to send, e.g. "10.10 USDC". */
  send?: string;
  refundTo?: string;
  /** What the business receives, e.g. "$10.00". */
  receive?: string;
  refunded?: string | null;
  refundReason?: string | null;
  /** A preview: no deposit address exists, so the words say what would happen in a real payment. */
  preview?: boolean;
};

/** Each 1Click status, in plain words, with what it means for the person paying. */
export function describeStatus(status: IntentStatus | "UNKNOWN", ctx: StatusContext = {}): StatusWords {
  const send = ctx.send ?? "the quoted amount";
  const refundTo = ctx.refundTo ? `your refund address (${ctx.refundTo})` : "your refund address";
  const receive = ctx.receive ?? "the payment";
  switch (status) {
    case "PENDING_DEPOSIT":
      return ctx.preview
        ? { label: "Waiting for your payment", tone: "waiting", final: false, meaning: `In a real payment, this is where you would send ${send} to a deposit address NEAR Intents creates for you. A preview creates none, so there is nothing to send. Until a customer sends, nothing happens and nothing is charged.` }
        : { label: "Waiting for your payment", tone: "waiting", final: false, meaning: `Nothing has arrived yet. Send ${send} to the deposit address before the quote expires. Until you send, nothing happens and nothing is charged.` };
    case "KNOWN_DEPOSIT_TX":
      return { label: "Payment seen", tone: "waiting", final: false, meaning: "Your payment was seen on the chain you paid from. NEAR Intents is waiting for it to confirm before converting it." };
    case "PROCESSING":
      return { label: "Converting", tone: "waiting", final: false, meaning: `Your payment arrived and is being converted to USDC on NEAR. The business has not been paid yet; this usually takes under a minute.` };
    case "SUCCESS":
      return { label: "Paid", tone: "done", final: true, meaning: `Done. The business received ${receive} at its payment address. It is split between its lenders and the business like any other sale: lenders are paid first.` };
    case "INCOMPLETE_DEPOSIT":
      return { label: "Too little sent", tone: "attention", final: false, meaning: `Less than ${send} arrived, so nothing was converted and the business has not been paid. Send the rest to the same deposit address before the quote expires; otherwise what you sent is returned to ${refundTo}.` };
    case "REFUNDED": {
      const amount = ctx.refunded ? `${ctx.refunded} was` : "Your payment was";
      const why = ctx.refundReason ? ` Reason given: ${ctx.refundReason}.` : "";
      return { label: "Refunded", tone: "attention", final: true, meaning: `The payment did not go through. ${amount} sent back to ${refundTo}, on the chain you paid from, less any network fee. The business received nothing, and you owe nothing more.${why}` };
    }
    case "FAILED":
      return { label: "Failed", tone: "bad", final: true, meaning: "The swap hit an error and the business received nothing. Keep the deposit address and your transaction hash: look it up on the NEAR Intents explorer, and contact NEAR Intents support if your money has not come back to your refund address." };
    default:
      return { label: "Unknown", tone: "attention", final: false, meaning: "NEAR Intents reported a status this page does not know. Look the deposit address up on the NEAR Intents explorer." };
  }
}

/** The happy path, in order, for the progress steps and the dry-run walkthrough. */
export const HAPPY_PATH: IntentStatus[] = ["PENDING_DEPOSIT", "KNOWN_DEPOSIT_TX", "PROCESSING", "SUCCESS"];

export const INTENTS_EXPLORER = "https://explorer.near-intents.org";
