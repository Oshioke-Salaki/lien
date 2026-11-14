// The sample businesses the Lien team runs on the test network, so a visitor always has
// something to lend to, buy from, take over and bid on. They are labelled as samples only
// while the team still owns them: once one is bought at auction, it belongs to its buyer
// and says so. They get plain descriptions in place of the setup notes stored on chain.

import { deployment } from "./config";
import { shortAccount } from "./format";

const SAMPLE = /^(sentinel|watch|beacon|lookout)[a-z0-9-]*$/;
/** The team's accounts that own the samples. */
export const TEAM = new Set(["lien-f1-3833.testnet", "lien-f4-3863.testnet"]);

/** Whether a business was created as one of the team's samples (whoever owns it now). */
export function isSample(id: string): boolean {
  const suffix = `.${deployment.registry}`;
  return id.endsWith(suffix) && SAMPLE.test(id.slice(0, -suffix.length));
}

/** A sample the Lien team still owns. */
export const isTeamSample = (b: { id: string; operator: string }) => isSample(b.id) && TEAM.has(b.operator);

/** A free test account made in a browser (lib/wallet/guest.ts), or one a test script made. */
export const isGuestAccount = (account: string) =>
  /\.guests\.[a-z\d-]+\.testnet$/.test(account) || account.startsWith("lien-guest-");

/** Owned by a free test account made in a browser (lib/wallet/guest.ts), or by a test script. */
export const isGuestOwned = (b: { operator: string }) => isGuestAccount(b.operator);

/**
 * An account the Lien team runs: the role accounts (lien-f1-3833 and friends), the lender and
 * borrower agents, the vault and the faucet tap (lien-lender-645368 and so on), the project's
 * root account, and the sub-accounts of any of these. Guest accounts live under the root but
 * belong to visitors, so they are never the team's.
 */
export function isTeamAccount(account: string): boolean {
  if (isGuestAccount(account)) return false;
  if (/(^|\.)lien-(f\d+|lender|borrower|vault|tap)-\d+\.testnet$/.test(account)) return true;
  return account === "lien-13569.testnet" || account.endsWith(".lien-13569.testnet");
}

/** A business the team runs: any business a team account owns, sample or not (Harbor, Courier, Relay...). */
export const isTeamRun = (b: { operator: string }) => isTeamAccount(b.operator);

/**
 * Loans whose payment clock runs in minutes rather than days are staged demonstrations: a
 * real business is never asked to pay every five minutes. The team opens them (ops/src/restock.ts,
 * the lender-agent demo) so a visitor always has something to take over or bid on, and they fall
 * behind by design. The rule reads only the loan's own terms on chain, so it is the same for
 * everyone and cannot be bent by a name.
 */
export const FAST_CLOCK_SECS = 3_600;
export const isStagedLoan = (loan: { terms: { window_secs: number } }) => loan.terms.window_secs < FAST_CLOCK_SECS;

/** Businesses made to poke at the product (reviews, audits, probes, the prompt-injection demo), named as such. */
export const looksLikeProbe = (b: { id: string; name: string }) =>
  /\b(probe|audit|critic|test|lumen|injection)\b/i.test(b.name) || /^(audit|critic|probe|lumen|inject)-/.test(b.id);

/** A sample someone bought at auction. */
export const isBoughtSample = (b: { id: string; operator: string }) => isSample(b.id) && !TEAM.has(b.operator);

// What every sample sells, in plain words. Their state (raising, late, for sale) changes as
// visitors use them, so it is shown by the page's status and headline, never written here.
const SAMPLE_DESCRIPTION = "Checks a NEAR account before an agent pays it or signs for it, and reports what could go wrong.";

/** A plain description for a sample, or the business's own words for everyone else. */
export function describe(id: string, onChain: string): string {
  return isSample(id) ? SAMPLE_DESCRIPTION : onChain;
}

/** The sample with the NEAR AI verdict turned on (ops/src/enable-ai.ts), named where a report has none. */
export const AI_SAMPLE = `beacon-repaid-7978.${deployment.registry}`;

export const SAMPLE_NOTE ="Sample business run by the Lien team on the test network";

/** The label a sample carries: run by the team, or bought by its new owner. */
export function sampleNote(b: { id: string; operator: string }): string | null {
  if (!isSample(b.id)) return null;
  return TEAM.has(b.operator) ? SAMPLE_NOTE : `Bought by ${shortAccount(b.operator, 22)} at auction`;
}
