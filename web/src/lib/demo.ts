// The sample businesses the Lien team runs on the test network, so a visitor always has
// something to lend to, buy from, take over and bid on. They are labelled as samples
// wherever they appear, and get plain descriptions in place of the setup notes stored
// on chain when they were created.

import { deployment } from "./config";

const SAMPLE = /^(sentinel|watch|beacon|lookout)[a-z0-9-]*$/;

/** Whether a business is one of the team's labelled samples. */
export function isSample(id: string): boolean {
  const suffix = `.${deployment.registry}`;
  return id.endsWith(suffix) && SAMPLE.test(id.slice(0, -suffix.length));
}

// What every sample sells, in plain words. Their state (raising, late, for sale) changes as
// visitors use them, so it is shown by the page's status and headline, never written here.
const SAMPLE_DESCRIPTION = "Checks a NEAR account before an agent pays it or signs for it, and reports what could go wrong.";

/** A plain description for a sample, or the business's own words for everyone else. */
export function describe(id: string, onChain: string): string {
  return isSample(id) ? SAMPLE_DESCRIPTION : onChain;
}

export const SAMPLE_NOTE = "Sample business run by the Lien team on the test network";
