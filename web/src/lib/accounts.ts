// What counts as a NEAR account, wherever the app takes one from a person.

/** A whole NEAR account id: 2 to 64 characters, lowercase parts joined by dots, - or _ inside a part. */
export const ACCOUNT_ID = /^(?=.{2,64}$)(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;

export const isAccountId = (text: string) => ACCOUNT_ID.test(text.trim());

/**
 * Whether some text names an account a check can look at: a named account ending in .testnet
 * or .near (inside a sentence is fine), or a 64-character implicit account.
 */
export function hasAccountName(text: string): boolean {
  return /(^|[\s"'(])([a-z\d]+[-_])*[a-z\d]+(\.([a-z\d]+[-_])*[a-z\d]+)*\.(testnet|near)(?=$|[\s"').,?!])/i.test(text)
    || /(^|[^0-9a-f])[0-9a-f]{64}($|[^0-9a-f])/i.test(text);
}

/** A label for a new business: what goes before ".v1.lien-13569.testnet". */
export function labelProblem(label: string): string | null {
  if (!label) return "Choose an account name.";
  if (label.length < 2) return "Use at least 2 characters.";
  if (label.length > 32) return "Use at most 32 characters.";
  if (/[A-Z]/.test(label)) return "Use lowercase letters only.";
  if (!/^[a-z\d-_]+$/.test(label)) return "Use only letters, numbers, - and _.";
  if (/^[-_]|[-_]$/.test(label)) return "Start and end with a letter or a number.";
  if (/[-_]{2}/.test(label)) return "Do not put two - or _ in a row.";
  return null;
}
