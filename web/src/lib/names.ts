/**
 * A business's name, told apart from others with the same name by the end of its account
 * id: "Lookout (late-1624)". Names are chosen by owners and need not be unique on chain.
 */
export function distinctName(business: { id: string; name: string }, all: Array<{ id: string; name: string }>): string {
  const name = business.name.trim();
  const twins = all.filter((b) => b.name.trim().toLowerCase() === name.toLowerCase() && b.id !== business.id);
  if (!twins.length) return name;
  const label = business.id.split(".")[0] ?? business.id;
  const prefix = `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-`;
  return `${name} (${label.startsWith(prefix) ? label.slice(prefix.length) : label})`;
}
