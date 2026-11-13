/** Fired after every confirmed transaction; all live data on the page re-reads at once. */
export const REFRESH_EVENT = "lien:refresh";

/**
 * Settles a pending transaction notice early, when its outcome is already known some other way
 * (a check's result read from the contract while the payment transaction is still finalising).
 */
export const SETTLE_EVENT = "lien:settle-notice";
export type SettleDetail = { summary: string; title: string; text: string; tone: "done" | "error" };
export const settleNotice = (detail: SettleDetail) => window.dispatchEvent(new CustomEvent<SettleDetail>(SETTLE_EVENT, { detail }));
