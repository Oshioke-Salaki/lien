import { deployment, isTestnet } from "./config";

const DECIMALS = BigInt(deployment.tokenDecimals);
const UNIT = 10n ** DECIMALS;

/** "1234567" -> "1.23" (plain number, two decimals by default, never rounds up past what is held). */
export function amount(value: bigint | string, decimals = 2): string {
  const v = typeof value === "string" ? BigInt(value) : value;
  const sign = v < 0n ? "-" : "";
  const abs = v < 0n ? -v : v;
  const whole = (abs / UNIT).toLocaleString("en-US");
  const fraction = (abs % UNIT).toString().padStart(Number(DECIMALS), "0").slice(0, decimals);
  return decimals === 0 ? `${sign}${whole}` : `${sign}${whole}.${fraction}`;
}

/** Exact to the last unit, with at least two decimals, so parts always add up on screen. */
export function smartAmount(value: bigint | string): string {
  const full = amount(value, Number(DECIMALS));
  return full.replace(/(\.\d{2}\d*?)0+$/, "$1");
}

export const symbol = deployment.tokenSymbol;
/** What the unit is called in words: the token is a dollar stablecoin (test dollars on testnet). */
export const unitName = isTestnet ? "test dollars" : "USDC";
/** One cent in base units. */
export const CENT = UNIT / 100n;

/** Rounds base units to the nearest cent (half up), keeping the sign. */
export function toCents(value: bigint | string): bigint {
  const v = BigInt(value);
  const abs = v < 0n ? -v : v;
  const rounded = ((abs + CENT / 2n) / CENT) * CENT;
  return v < 0n ? -rounded : rounded;
}

/** Rounds base units up to the next whole cent: for minimums, so the shown value is always accepted. */
export function centsUp(value: bigint | string): bigint {
  const v = BigInt(value);
  return v <= 0n ? v : ((v + CENT - 1n) / CENT) * CENT;
}

const dollars = (units: bigint, text: string) => (units < 0n ? `-$${text.replace(/^-/, "")}` : `$${text}`);

/**
 * Amounts read as dollars to the cent, the way any banking app shows them. A positive amount
 * under half a cent reads "<$0.01" rather than a misleading "$0.00".
 */
export const money = (value: bigint | string) => {
  const v = BigInt(value);
  if (v > 0n && v < CENT / 2n) return "<$0.01";
  return dollars(v, amount(toCents(v)));
};

/**
 * What is still owed, shown as the total minus what was repaid after rounding both to the cent,
 * so "repaid" and "still owed" on one screen always add up to the total shown beside them.
 */
export const owedMoney = (totalDue: bigint | string, repaid: bigint | string) => money(toCents(totalDue) - toCents(repaid));

/** A minimum, rounded up to the cent, so typing the shown number always clears it. */
export const moneyUp = (value: bigint | string) => dollars(BigInt(value), amount(centsUp(value)));

/**
 * Exact to the last unit, with at least two decimals: only where parts must visibly add up
 * to a whole, such as the split of a single $0.25 sale.
 */
export const moneyExact = (value: bigint | string) => {
  const text = smartAmount(value);
  return text.startsWith("-") ? `-$${text.slice(1)}` : `$${text}`;
};

/** A plain number for an input field: no trailing zeros, no thousands separators ("15", "12.5"). */
export function inputAmount(value: bigint | string): string {
  const full = amount(value, Number(DECIMALS)).replace(/,/g, "");
  return full.includes(".") ? full.replace(/0+$/, "").replace(/\.$/, "") : full;
}

/** Parses "12.5" into base units. Returns null for anything that is not an amount. */
export function parseAmount(text: string): bigint | null {
  const clean = text.trim().replace(/,/g, "");
  if (!/^\d*\.?\d*$/.test(clean) || clean === "" || clean === ".") return null;
  const [whole = "0", fraction = ""] = clean.split(".");
  if (fraction.length > Number(DECIMALS)) return null;
  return BigInt(whole || "0") * UNIT + BigInt(fraction.padEnd(Number(DECIMALS), "0") || "0");
}

export const percent = (bps: number) => `${(bps / 100).toFixed(bps % 100 === 0 ? 0 : 2)}%`;

/** A percentage for display: whole numbers, except below 1% where two decimals keep it honest. */
export function pct(value: number): string {
  if (value > 0 && value < 1) return `${value.toFixed(2)}%`;
  return `${Math.round(value)}%`;
}

export function share(part: bigint | string, whole: bigint | string): number {
  const p = BigInt(part);
  const w = BigInt(whole);
  if (w === 0n) return 0;
  return Number((p * 10_000n) / w) / 100;
}

export function duration(totalSecs: number): string {
  const secs = Math.max(0, Math.round(totalSecs));
  if (secs < 60) return `${secs}s`;
  if (secs < 3_600) return `${Math.round(secs / 60)} min`;
  if (secs < 86_400) {
    const hours = Math.round((secs / 3_600) * 10) / 10;
    return `${hours} h`;
  }
  const days = Math.round((secs / 86_400) * 10) / 10;
  return `${days} ${days === 1 ? "day" : "days"}`;
}

/** Live wording for a moment relative to chain time. */
export function fromNow(at: number, now: number): string {
  const delta = at - now;
  if (Math.abs(delta) < 2) return "now";
  return delta > 0 ? `in ${duration(delta)}` : `${duration(-delta)} ago`;
}

/**
 * A moment as "2 Feb, 19:14 UTC". Always UTC, so the server's page and the browser's agree
 * (a local time zone would differ between them and break hydration), and every visitor
 * reads the same time.
 */
export function dateTime(unixSeconds: number): string {
  return `${new Date(unixSeconds * 1000).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  })} UTC`;
}

export const shortHash = (hash: string, size = 8) =>
  hash.length <= size * 2 + 1 ? hash : `${hash.slice(0, size)}…${hash.slice(-size)}`;

/** Long implicit accounts and long sub-accounts, kept readable. */
export function shortAccount(id: string, max = 28): string {
  if (id.length <= max) return id;
  const parts = id.split(".");
  // Keep the first name and the network ("g134k3ya….testnet"): whole parts, never a cut word.
  if (parts.length > 1) {
    const first = parts[0]!;
    const last = parts[parts.length - 1]!;
    const short = `${first}….${last}`;
    if (short.length <= max) return short;
    return `${first.slice(0, Math.max(4, max - last.length - 2))}….${last}`;
  }
  return `${id.slice(0, max - 10)}…${id.slice(-9)}`;
}

export const nearAmount = (yocto: string | bigint, decimals = 2) => {
  const v = BigInt(yocto);
  const unit = 10n ** 24n;
  const whole = v / unit;
  const fraction = ((v % unit) * 10n ** BigInt(decimals)) / unit;
  return `${whole}.${fraction.toString().padStart(decimals, "0")}`;
};

export const toYocto = (near: string): string => {
  const [whole = "0", fraction = ""] = near.split(".");
  return (BigInt(whole) * 10n ** 24n + BigInt(fraction.padEnd(24, "0").slice(0, 24))).toString();
};
