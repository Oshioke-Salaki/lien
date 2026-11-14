import { describe, expect, it } from "vitest";
import {
  buildQuoteRequest, chainOf, describeStatus, friendlyQuoteError, INTENT_STATUSES, isFinalStatus, oneClickHeaders, previewRefund, readQuote, readStatus, refundProblem, USDC_NEAR,
} from "./intents";

const NOW = Date.UTC(2026, 10, 14, 12, 0, 0);
const BASE_USDC = "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near";
const input = { originAsset: BASE_USDC, amount: "10000000", refundTo: "0xD8dA6BF26964aF9D7eEd9e03E53415D37aA96045", recipient: "sentinel-in.v1.lien-13569.testnet" };

describe("building a 1Click quote request", () => {
  it("asks for an exact USDC amount on NEAR, delivered to the business's payment address", () => {
    const built = buildQuoteRequest(input, { mainnet: true, now: NOW });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.request).toEqual({
      dry: false,
      swapType: "EXACT_OUTPUT",
      slippageTolerance: 100,
      originAsset: BASE_USDC,
      depositType: "ORIGIN_CHAIN",
      destinationAsset: USDC_NEAR,
      amount: "10000000",
      refundTo: "0xd8da6bf26964af9d7eed9e03e53415d37aa96045",
      refundType: "ORIGIN_CHAIN",
      recipient: "sentinel-in.v1.lien-13569.testnet",
      recipientType: "DESTINATION_CHAIN",
      deadline: "2026-11-14T13:00:00.000Z",
    });
  });

  it("is non-dry by default, so 1Click returns a deposit address; dry only when asked", () => {
    const real = buildQuoteRequest(input, { mainnet: false, now: NOW });
    const dry = buildQuoteRequest({ ...input, dry: true }, { mainnet: false, now: NOW });
    expect(real.ok && real.request.dry).toBe(false);
    expect(dry.ok && dry.request.dry).toBe(true);
    // Only a literal true counts: a string from a form must not turn a real quote into a dry one or back.
    const odd = buildQuoteRequest({ ...input, dry: "true" }, { mainnet: false, now: NOW });
    expect(odd.ok && odd.request.dry).toBe(false);
  });

  it("on testnet keeps the business's own name, inside the Intents ledger, since mainnet NEAR has no .testnet accounts", () => {
    const built = buildQuoteRequest(input, { mainnet: false, now: NOW });
    expect(built.ok && built.request.recipient).toBe(input.recipient);
    expect(built.ok && built.request.recipientType).toBe("INTENTS");
  });

  it("keeps non-EVM refund addresses as typed, trimmed", () => {
    const sol = buildQuoteRequest({ ...input, originAsset: "nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near", refundTo: "  9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin " }, { mainnet: true, now: NOW });
    expect(sol.ok && sol.request.refundTo).toBe("9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin");
  });

  it("refuses bad input before calling 1Click", () => {
    const bad = (over: object) => buildQuoteRequest({ ...input, ...over }, { mainnet: true, now: NOW });
    expect(bad({ amount: "0" }).ok).toBe(false);
    expect(bad({ amount: "1.5" }).ok).toBe(false);
    expect(bad({ amount: 10 }).ok).toBe(false);
    expect(bad({ originAsset: "usdc" }).ok).toBe(false);
    expect(bad({ recipient: "Not An Account" }).ok).toBe(false);
    expect(bad({ refundTo: "" }).ok).toBe(false);
    expect(bad({ refundTo: "<script>" }).ok).toBe(false);
  });

  it("accepts any EVM address of the right shape, checksummed or not, and sends it in one case", () => {
    for (const refundTo of ["0x000000000000000000000000000000000000dEaD", "0x000000000000000000000000000000000000DEAD", "0xd8da6bf26964af9d7eed9e03e53415d37aa96045"]) {
      const built = buildQuoteRequest({ ...input, refundTo }, { mainnet: true, now: NOW });
      expect(built.ok, refundTo).toBe(true);
      expect(built.ok && built.request.refundTo).toBe(refundTo.toLowerCase());
    }
  });

  it("checks the refund address against the chain being paid from", () => {
    const SOL_USDC = "nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near";
    expect(refundProblem("0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045", BASE_USDC)).toBeNull();
    expect(refundProblem("0xd8dA6BF26964aF9D7eEd9e03E53415D37aA9604", BASE_USDC)).toMatch(/Base address/); // 39 digits
    expect(refundProblem("nonsense", BASE_USDC)).toMatch(/does not look right/);
    expect(refundProblem("9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin", SOL_USDC)).toBeNull();
    expect(refundProblem("0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045", SOL_USDC)).toMatch(/Solana/);
    expect(refundProblem("", BASE_USDC)).toMatch(/Enter your address/);
    expect(chainOf(BASE_USDC)?.name).toBe("Base");
  });

  it("lets a preview leave the refund address empty, and a real quote never", () => {
    const preview = buildQuoteRequest({ ...input, refundTo: "", dry: true }, { mainnet: false, now: NOW });
    expect(preview.ok && preview.request.refundTo).toBe(previewRefund(BASE_USDC));
    expect(buildQuoteRequest({ ...input, refundTo: "", dry: false }, { mainnet: false, now: NOW }).ok).toBe(false);
    // An address typed into a preview is still checked.
    expect(buildQuoteRequest({ ...input, refundTo: "nonsense", dry: true }, { mainnet: false, now: NOW }).ok).toBe(false);
  });

  it("says plainly when 1Click refuses an address of the right shape", () => {
    expect(friendlyQuoteError("refundTo is not valid")).toMatch(/would not take this refund address/);
  });

  it("sends the partner key only when one is set", () => {
    expect(oneClickHeaders()).toEqual({ "content-type": "application/json" });
    expect(oneClickHeaders("jwt")).toEqual({ "content-type": "application/json", "x-api-key": "jwt" });
  });
});

describe("reading a quote", () => {
  const request = (dry: boolean) => { const b = buildQuoteRequest({ ...input, dry }, { mainnet: false, now: NOW }); if (!b.ok) throw new Error(); return b.request; };
  const response = { quote: { amountIn: "10101790", amountInFormatted: "10.10179", amountOutFormatted: "10.0", timeEstimate: 35, depositAddress: "0x6659A558712e57f8deE08B1B8644EFa13CACF8b9", deadline: "2026-11-14T13:00:00.000Z", timeWhenInactive: "2026-11-17T09:21:28.751Z" } };

  it("keeps the deposit address of a real quote, and when 1Click stops watching it", () => {
    const q = readQuote(request(false), response)!;
    expect(q.depositAddress).toBe("0x6659A558712e57f8deE08B1B8644EFa13CACF8b9");
    expect(q.deadline).toBe("2026-11-17T09:21:28.751Z");
    expect(q.amountInFormatted).toBe("10.10179");
  });

  it("never shows a deposit address for a dry quote", () => {
    expect(readQuote(request(true), response)!.depositAddress).toBeNull();
  });

  it("returns nothing for an error body", () => {
    expect(readQuote(request(false), { message: "x" })).toBeNull();
  });

  it("turns 1Click errors into words", () => {
    expect(friendlyQuoteError("refundTo is not valid")).toMatch(/refund address/);
    expect(friendlyQuoteError("Internal server error")).toBe("No route is available right now.");
    expect(friendlyQuoteError(undefined)).toBe("No route is available right now.");
  });
});

describe("1Click statuses, in plain words", () => {
  it("has a distinct label and meaning for every status in the API", () => {
    const labels = INTENT_STATUSES.map((s) => describeStatus(s).label);
    expect(new Set(labels).size).toBe(INTENT_STATUSES.length);
    for (const s of INTENT_STATUSES) expect(describeStatus(s).meaning.length).toBeGreaterThan(40);
  });

  it("stops polling only on SUCCESS, REFUNDED and FAILED", () => {
    expect(INTENT_STATUSES.filter(isFinalStatus)).toEqual(["SUCCESS", "REFUNDED", "FAILED"]);
    for (const s of INTENT_STATUSES) expect(describeStatus(s).final).toBe(isFinalStatus(s));
  });

  it("tells a refunded customer where the money went", () => {
    const w = describeStatus("REFUNDED", { refundTo: "0xabc", refunded: "10.1 USDC", refundReason: "Deposit expired" });
    expect(w.meaning).toContain("10.1 USDC was sent back to your refund address (0xabc)");
    expect(w.meaning).toContain("business received nothing");
    expect(w.meaning).toContain("Deposit expired");
  });

  it("tells a short payer to top up or expect a refund", () => {
    const w = describeStatus("INCOMPLETE_DEPOSIT", { send: "10.10 USDC", refundTo: "0xabc" });
    expect(w.meaning).toContain("Less than 10.10 USDC arrived");
    expect(w.meaning).toContain("returned to your refund address (0xabc)");
    expect(w.final).toBe(false);
  });

  it("says success pays lenders first, and failure pays no one", () => {
    expect(describeStatus("SUCCESS", { receive: "$10.00" }).meaning).toContain("received $10.00");
    expect(describeStatus("SUCCESS").meaning).toContain("lenders are paid first");
    expect(describeStatus("FAILED").tone).toBe("bad");
    expect(describeStatus("PENDING_DEPOSIT").meaning).toContain("nothing is charged");
  });

  it("does not guess at a status it does not know", () => {
    expect(describeStatus("UNKNOWN").label).toBe("Unknown");
  });
});

describe("reading a status response", () => {
  it("reads 1Click's shape, as returned for a real deposit address", () => {
    const v = readStatus({
      status: "PENDING_DEPOSIT", updatedAt: "2026-11-14T08:21:30.312Z",
      swapDetails: { depositedAmountFormatted: null, amountOutFormatted: null, refundedAmountFormatted: "0", refundReason: null, originChainTxHashes: [], destinationChainTxHashes: [] },
    });
    expect(v).toMatchObject({ status: "PENDING_DEPOSIT", refundedFormatted: null, originTxs: [], updatedAt: "2026-11-14T08:21:30.312Z" });
  });

  it("collects transaction hashes, and keeps a refund and its reason", () => {
    const v = readStatus({ status: "REFUNDED", swapDetails: { refundedAmountFormatted: "9.9", refundReason: "Slippage", originChainTxHashes: [{ hash: "0x1", explorerUrl: "" }], destinationChainTxHashes: ["0x2"] } });
    expect(v).toMatchObject({ status: "REFUNDED", refundedFormatted: "9.9", refundReason: "Slippage", originTxs: ["0x1"], destinationTxs: ["0x2"] });
  });

  it("marks a status it does not recognise as UNKNOWN, keeping the raw text", () => {
    expect(readStatus({ status: "NEW_THING" })).toMatchObject({ status: "UNKNOWN", rawStatus: "NEW_THING" });
    expect(readStatus(null).status).toBe("UNKNOWN");
  });
});
