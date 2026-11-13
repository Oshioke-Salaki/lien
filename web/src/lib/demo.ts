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

/** A sample someone bought at auction. */
export const isBoughtSample = (b: { id: string; operator: string }) => isSample(b.id) && !TEAM.has(b.operator);

// What every sample sells, in plain words. Their state (raising, late, for sale) changes as
// visitors use them, so it is shown by the page's status and headline, never written here.
const SAMPLE_DESCRIPTION = "Checks a NEAR account before an agent pays it or signs for it, and reports what could go wrong.";

/** A plain description for a sample, or the business's own words for everyone else. */
export function describe(id: string, onChain: string): string {
  return isSample(id) ? SAMPLE_DESCRIPTION : onChain;
}

export const SAMPLE_NOTE = "Sample business run by the Lien team on the test network";

/** The label a sample carries: run by the team, or bought by its new owner. */
export function sampleNote(b: { id: string; operator: string }): string | null {
  if (!isSample(b.id)) return null;
  return TEAM.has(b.operator) ? SAMPLE_NOTE : `Bought by ${shortAccount(b.operator, 22)} at auction`;
}
