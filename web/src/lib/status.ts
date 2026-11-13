// One place decides what state a business is in and what words describe it.

import type { Business, LoanView } from "./near/types";

export type Standing =
  | "no-loan"
  | "funding"
  | "current"
  | "behind"
  | "foreclosable"
  | "foreclosed"
  | "auction"
  | "sale-ended";

export function standing(b: Business): Standing {
  const loan = b.current_loan;
  if (!loan) return "no-loan";
  if (loan.status === "Funding") return "funding";
  if (loan.status === "Foreclosed") {
    // Once the auction clock has run out, the only thing left is completing the sale.
    if (loan.auction.ends_at !== null && b.now >= loan.auction.ends_at) return "sale-ended";
    return loan.auction.high_bidder ? "auction" : "foreclosed";
  }
  if (loan.foreclosable_at !== null && b.now >= loan.foreclosable_at) return "foreclosable";
  if (loan.is_behind) return "behind";
  return "current";
}

export const STANDING_LABEL: Record<Standing, string> = {
  "no-loan": "No loan",
  funding: "Raising",
  current: "Paying on time",
  behind: "Behind on payments",
  foreclosable: "Can be taken over",
  foreclosed: "Taken over, for sale",
  auction: "For sale, bids in",
  "sale-ended": "Auction ended: anyone can complete the sale",
};

/** Whether the state needs someone to act, which decides its emphasis. */
export const isAlert = (s: Standing) => s === "behind" || s === "foreclosable" || s === "foreclosed" || s === "auction" || s === "sale-ended";

/** Behind or taken over: the owner's share of each sale goes to lenders. */
export const isTrapped = (s: Standing) => s === "behind" || s === "foreclosable" || s === "foreclosed" || s === "auction" || s === "sale-ended";

export const auctionEnded = (loan: LoanView, now: number) =>
  loan.auction.ends_at !== null && now >= loan.auction.ends_at;
