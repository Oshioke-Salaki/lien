import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Facts } from "./risk";

// The chain is replaced by a table: one business, one note, one listing.
const BUSINESS = "watchtower-late-5337.v1.lien-13569.testnet";
const MARKET = "notemarket.lien-13569.testnet";
const chain = vi.hoisted(() => ({
  notes: {} as Record<string, unknown>,
  listing: null as Record<string, unknown> | null,
  listed: [] as string[],
  facts: {} as Record<string, unknown>,
}));
vi.mock("./near/rpc", () => ({
  readFacts: async (id: string) => chain.facts[id] ?? { exists: false, hasContract: false, fullAccessKeys: 0, functionCallKeys: 0, balanceNear: 0, storageBytes: 0 },
  listBusinessIds: async () => chain.listed,
  getNote: async (_id: string, _loan: number, who: string) => chain.notes[who] ?? null,
  getListing: async () => chain.listing,
  getListings: async () => (chain.listing ? [chain.listing] : []),
}));
const { handle } = await import("./mcp");

const KEYLESS_BUSINESS: Facts = { exists: true, hasContract: true, fullAccessKeys: 0, functionCallKeys: 0, balanceNear: 0, storageBytes: 13_792 };
const NOTE = { principal: "40000000", claimed: "0", voted_proposal: null, claimable: "5230000" };
const FOR_SALE = { business: BUSINESS, loan_id: 0, seller: "seller.testnet", price: "30000000", principal: "40000000", status: "ForSale", busy: false, listed_at: 1 };

type Unsigned = { receiver_id: string; signer_id: string; actions: { method_name: string; args: Record<string, unknown>; deposit: string }[] };
type Structured = Partial<Unsigned> & { transactions?: Unsigned[]; note?: string; gate?: { passed: boolean }; listing?: Record<string, unknown>; notes?: Record<string, unknown>[]; refused?: boolean };
type ToolReply = { result: { isError: boolean; content: { text: string }[]; structuredContent?: Structured } };
const call = async (name: string, args: Record<string, unknown>) => ((await handle({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } })) as ToolReply).result;

beforeEach(() => {
  chain.notes = {};
  chain.listing = null;
  chain.listed = [BUSINESS];
  chain.facts = { [BUSINESS]: KEYLESS_BUSINESS };
});

describe("prepare_list_note", () => {
  it("returns reserve, transfer and confirm, in that order, for the seller to sign", async () => {
    chain.notes["seller.testnet"] = NOTE;
    const out = await call("prepare_list_note", { business: "watchtower-late-5337", seller: "seller.testnet", loan_id: 0, price: "30" });
    expect(out.isError).toBe(false);
    const txs = out.structuredContent!.transactions!;
    expect(txs.map((t) => [t.receiver_id, t.actions[0].method_name])).toEqual([
      [MARKET, "list"],
      [BUSINESS, "transfer_note"],
      [MARKET, "confirm"],
    ]);
    expect(txs.every((t) => t.signer_id === "seller.testnet")).toBe(true);
    expect(txs[0].actions[0].args).toEqual({ business: BUSINESS, loan_id: 0, price: "30000000" });
    expect(txs[0].actions[0].deposit).toBe("10000000000000000000000");
    expect(txs[1].actions[0]).toMatchObject({ args: { loan_id: 0, to: MARKET }, deposit: "1" });
    expect(out.structuredContent!.note).toMatch(/5\.23 tUSD goes to the buyer/);
  });

  it("refuses a seller without a note, and a loan that is already listed", async () => {
    const none = await call("prepare_list_note", { business: BUSINESS, seller: "nobody.testnet", loan_id: 0, price: "30" });
    expect(none).toMatchObject({ isError: true });
    expect(none.content[0].text).toMatch(/holds no note/);
    chain.notes["seller.testnet"] = NOTE;
    chain.listing = FOR_SALE;
    const taken = await call("prepare_list_note", { business: BUSINESS, seller: "seller.testnet", loan_id: 0, price: "30" });
    expect(taken.content[0].text).toMatch(/already has a listing/);
  });
});

describe("prepare_buy_note", () => {
  it("pays exactly the listed price to the market in one ft_transfer_call", async () => {
    chain.listing = FOR_SALE;
    chain.notes[MARKET] = NOTE;
    const out = await call("prepare_buy_note", { business: BUSINESS, loan_id: 0, buyer: "buyer.testnet" });
    expect(out.isError).toBe(false);
    const s = out.structuredContent!;
    expect(s.receiver_id).toBe("usd.lien-13569.testnet");
    expect(s.signer_id).toBe("buyer.testnet");
    expect(s.actions).toHaveLength(1);
    const [action] = s.actions!;
    expect(action).toMatchObject({ method_name: "ft_transfer_call", deposit: "1" });
    expect(action.args).toEqual({ receiver_id: MARKET, amount: "30000000", msg: JSON.stringify({ buy: { business: BUSINESS, loan_id: 0 } }) });
    expect(s.listing).toMatchObject({ price: "30 tUSD", claimable_now: "5.23 tUSD" });
    expect(s.gate!.passed).toBe(true);
  });

  it("refuses notes that are not listed, not delivered yet, or the buyer's own", async () => {
    expect((await call("prepare_buy_note", { business: BUSINESS, loan_id: 0, buyer: "buyer.testnet" })).content[0].text).toMatch(/no note for sale/);
    chain.listing = { ...FOR_SALE, status: "Pending" };
    expect((await call("prepare_buy_note", { business: BUSINESS, loan_id: 0, buyer: "buyer.testnet" })).content[0].text).toMatch(/not for sale yet/);
    chain.listing = FOR_SALE;
    expect((await call("prepare_buy_note", { business: BUSINESS, loan_id: 0, buyer: "seller.testnet" })).content[0].text).toMatch(/your own listing/);
  });

  it("is gated on the business: a note on an unlisted account is refused", async () => {
    chain.listing = FOR_SALE;
    chain.listed = [];
    const out = await call("prepare_buy_note", { business: BUSINESS, loan_id: 0, buyer: "buyer.testnet" });
    expect(out.isError).toBe(true);
    expect(out.structuredContent).toMatchObject({ refused: true });
  });
});

describe("list_notes_for_sale", () => {
  it("shows only notes the market holds, with what they can collect", async () => {
    chain.notes[MARKET] = NOTE;
    chain.listing = { ...FOR_SALE, status: "Pending" };
    expect((await call("list_notes_for_sale", {})).structuredContent!.notes).toEqual([]);
    chain.listing = FOR_SALE;
    const notes = (await call("list_notes_for_sale", {})).structuredContent!.notes;
    expect(notes).toEqual([{ business: BUSINESS, loan_id: 0, seller: "seller.testnet", price: "30 tUSD", price_units: "30000000", principal: "40 tUSD", claimable_now: "5.23 tUSD", sale_in_progress: false }]);
  });
});
