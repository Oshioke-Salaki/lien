// Businesses this account has dealt with, remembered in this browser, so "Your positions"
// reads them first instead of after every other business in the registry.

const key = (account: string) => `lien:mine:${account}`;

export function remembered(account: string): string[] {
  try {
    const list = JSON.parse(localStorage.getItem(key(account)) ?? "[]");
    return Array.isArray(list) ? list.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

export function remember(account: string, businessId: string): void {
  try {
    const list = remembered(account).filter((id) => id !== businessId);
    localStorage.setItem(key(account), JSON.stringify([businessId, ...list].slice(0, 50)));
  } catch {
    /* storage unavailable: positions are still found, just a little later */
  }
}
