import { describe, expect, it } from "vitest";
import { mergePositions } from "./positions";
import type { PositionsSnapshot } from "./snapshot";
import type { LoanView, NoteView } from "./near/types";

const loan = { id: 0 } as LoanView;
const note = { principal: "1000000", claimed: "0", voted_proposal: null, claimable: "0" } as NoteView;
const snap = (over: Partial<PositionsSnapshot>): PositionsSnapshot => ({
  businesses: [], positions: [], credits: [], operated: [], bids: [], bought: [],
  readIds: [], checked: 0, total: 2, unread: 0, unreadIds: [], at: 0, ...over,
});

describe("mergePositions", () => {
  it("keeps a business's rows when the next read could not reach it", () => {
    const first = snap({ positions: [{ businessId: "a", loan, note }], readIds: ["a", "b"], checked: 2 });
    const next = snap({ readIds: ["b"], unreadIds: ["a"], unread: 1, checked: 1 });
    const merged = mergePositions(first, next);
    expect(merged.positions).toHaveLength(1);
    // Read once already, so it counts as checked: the page never goes back to "Checked 1 of 2".
    expect(merged.checked).toBe(2);
    expect(merged.unread).toBe(0);
  });
  it("drops a row only when a fresh read of that business says it is gone", () => {
    const first = snap({ positions: [{ businessId: "a", loan, note }], credits: [{ businessId: "a", amount: "5" }], readIds: ["a", "b"] });
    const next = snap({ readIds: ["a", "b"] });
    const merged = mergePositions(first, next);
    expect(merged.positions).toHaveLength(0);
    expect(merged.credits).toHaveLength(0);
  });
  it("counts up across reads until every business has been read", () => {
    const first = snap({ readIds: ["a"], unreadIds: ["b"], unread: 1, checked: 1 });
    const next = snap({ readIds: ["b"], unreadIds: ["a"], unread: 1, checked: 1 });
    const merged = mergePositions(first, next);
    expect(merged.checked).toBe(2);
    expect(merged.unreadIds).toEqual([]);
  });
});
