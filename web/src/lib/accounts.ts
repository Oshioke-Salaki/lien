// What counts as a NEAR account, wherever the app takes one from a person.

/** A whole NEAR account id: 2 to 64 characters, lowercase parts joined by dots, - or _ inside a part. */
export const ACCOUNT_ID = /^(?=.{2,64}$)(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;

export const isAccountId = (text: string) => ACCOUNT_ID.test(text.trim());

/**
 * An account someone can send money to by name: a named account ending in .testnet or .near,
 * or a 64-character implicit one. ("bob" alone is a valid id but nobody owns it.)
 */
export const isPayableAccount = (text: string) => {
  const id = text.trim();
  return ACCOUNT_ID.test(id) && (/\.(testnet|near)$/.test(id) || /^[0-9a-f]{64}$/.test(id));
};

/**
 * Whether some text names an account a check can look at: a named account ending in .testnet
 * or .near (inside a sentence is fine), or a 64-character implicit account.
 */
export function hasAccountName(text: string): boolean {
  if (text.length > 200) return false;
  // Every named account (name.testnet, name.near) must be a real-length NEAR account id: 2 to 64 characters.
  const named = [...text.matchAll(/(?:^|[\s"'(])((?:[a-z\d]+[-_])*[a-z\d]+(?:\.(?:[a-z\d]+[-_])*[a-z\d]+)*\.(?:testnet|near))(?=$|[\s"').,?!])/gi)].map((m) => m[1]!);
  if (named.some((n) => n.length >= 2 && n.length <= 64)) return true;
  return /(^|[^0-9a-f])[0-9a-f]{64}($|[^0-9a-f])/i.test(text);
}

/** Why a check's input can't be run, in plain words, or null when it names an account. */
export function checkInputProblem(text: string): string | null {
  const t = text.trim();
  if (!t) return "Type the account you want checked, like outlayer.testnet.";
  const long = [...t.matchAll(/[a-z\d._-]+\.(?:testnet|near)\b/gi)].find((m) => m[0].length > 64);
  if (long && !hasAccountName(t)) return "NEAR account names are at most 64 characters. Check the name and try again.";
  if (t.length > 200) return "That is too long. Type just the account, like outlayer.testnet.";
  return hasAccountName(t) ? null : "Type the account you want checked, like outlayer.testnet.";
}

/**
 * What a check would look at, refused before any money moves when it can't be a real account
 * on this network: capital letters (NEAR names are lowercase), a malformed name, or on the
 * test network a mainnet .near name. Null when the text is fine to send.
 */
export function targetProblem(text: string, testnet: boolean): string | null {
  const t = text.trim();
  if (!t) return null;
  const names = [...t.matchAll(/[A-Za-z\d._-]+\.(?:testnet|near)(?![A-Za-z\d_-])/gi)].map((m) => m[0]);
  const upper = names.find((n) => /[A-Z]/.test(n));
  if (upper) return `NEAR account names are lowercase: try ${upper.toLowerCase()}.`;
  const malformed = names.find((n) => n.length <= 64 && !ACCOUNT_ID.test(n));
  if (malformed && !hasAccountName(t)) return `${malformed} is not a valid NEAR account name. Names use lowercase letters, digits, - and _, joined by dots.`;
  if (testnet && names.length && names.every((n) => /\.near$/.test(n))) {
    return `${names[0]} is a mainnet name. This is the test network, so only .testnet accounts can be checked, like outlayer.testnet.`;
  }
  return checkInputProblem(t);
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
