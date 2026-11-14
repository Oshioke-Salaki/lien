/** The account label before the registry: "lookout-late-38178" for lookout-late-38178.v1.lien-13569.testnet. */
const labelOf = (id: string) => id.split(".")[0] ?? id;

/** A demo the team stages on a fast clock (ops/src/restock.ts names them "<name>-late-<n>" or "<name>-sale-<n>"). */
const isStagedLabel = (id: string) => /-(late|sale)-\d+$/.test(labelOf(id));

/**
 * A business's name, told apart from others with the same name without showing its account
 * id: "Lookout · demo 2" for the second staged Lookout, "Atlas · 2" for the second Atlas.
 * Names are chosen by owners and need not be unique on chain; the contract name never changes.
 *
 * `all` is the registry's list, newest first (get_agents), so counting from its end numbers
 * the oldest twin 1, and a new twin never renumbers the ones before it.
 */
export function distinctName(business: { id: string; name: string }, all: Array<{ id: string; name: string }>): string {
  const name = business.name.trim();
  const key = name.toLowerCase();
  const twins = all.filter((b) => b.name.trim().toLowerCase() === key);
  if (!twins.some((b) => b.id !== business.id)) return name;
  const staged = isStagedLabel(business.id);
  // Numbered among their own kind: staged demos as "demo n", the rest as plain "n".
  const kin = twins.filter((b) => isStagedLabel(b.id) === staged).reverse();
  const n = kin.findIndex((b) => b.id === business.id) + 1;
  if (staged) return n > 0 ? `${name} · demo ${n}` : `${name} · demo`;
  // The only one of its name that is not a staged demo keeps its plain name.
  if (kin.length <= 1) return name;
  return n > 0 ? `${name} · ${n}` : name;
}
