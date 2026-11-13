// One plain sentence for each word the app cannot avoid. Shown on tap, hover or focus.

export const GLOSSARY = {
  testDollars: "Play money for trying Lien. It works like dollars here but has no real value.",
  near: "NEAR is the network Lien runs on. Every action needs a tiny fee in NEAR, a fraction of a cent.",
  share: "Your part of the whole loan. You receive that part of every repayment.",
  takeOver: "Also called foreclosure. The business keeps running and selling, but its owner's share of each sale goes to lenders until someone buys it at auction.",
  grace: "Extra time after a missed payment. Any payment during it puts the loan back on track.",
  owner: "The person who started this business and borrowed against it.",
  runningCosts: "Money the business keeps to pay for the computers that do its work.",
  minimumPayment: "If lenders receive less than this in each period, the loan falls behind.",
  redeem: "Paying off the whole debt before the auction ends gives the business back to its owner.",
  check: "A safety report on a NEAR account, like a background check before you pay someone. It looks for risks such as an owner who can change the code or empty the account.",
  sealedComputer: "A secure computer (Intel TDX) that proves exactly which program it ran, so nobody can swap the code.",
  auction: "Anyone can bid, from the lowest first bid set in this loan's terms. The highest bid when the clock runs out buys the business, and the money pays lenders first.",
} as const;
