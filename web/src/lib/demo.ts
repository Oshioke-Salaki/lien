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

const DESCRIPTIONS: Record<string, string> = {
  sentinel: "Checks a NEAR account before an agent pays it or signs for it, and reports what could go wrong.",
  "sentinel-north": "The same account-safety check, raising its first loan from lenders.",
  "sentinel-late": "The same account-safety check. It missed its loan payments, on a fast demo clock.",
  "sentinel-sale": "The same account-safety check. It missed its payments and is now for sale to the highest bidder.",
};

/** A plain description for a sample, or the business's own words for everyone else. */
export function describe(id: string, onChain: string): string {
  const label = id.split(".")[0] ?? "";
  return (isSample(id) && DESCRIPTIONS[label]) || onChain;
}

export const SAMPLE_NOTE = "Sample business run by the Lien team on the test network";
