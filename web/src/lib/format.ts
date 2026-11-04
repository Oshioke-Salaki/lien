import { deployment } from "./config";

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

/** Like `amount`, with enough decimals that small prices do not print as 0.00. */
export function smartAmount(value: bigint | string): string {
  const v = typeof value === "string" ? BigInt(value) : value;
  if (v !== 0n && (v < 0n ? -v : v) < UNIT / 100n) return amount(v, Number(DECIMALS));
  return amount(v);
}

export const symbol = deployment.tokenSymbol;
export const money = (value: bigint | string) => `${smartAmount(value)} ${symbol}`;

/** Parses "12.5" into base units. Returns null for anything that is not an amount. */
export function parseAmount(text: string): bigint | null {
  const clean = text.trim().replace(/,/g, "");
  if (!/^\d*\.?\d*$/.test(clean) || clean === "" || clean === ".") return null;
  const [whole = "0", fraction = ""] = clean.split(".");
  if (fraction.length > Number(DECIMALS)) return null;
  return BigInt(whole || "0") * UNIT + BigInt(fraction.padEnd(Number(DECIMALS), "0") || "0");
}

export const percent = (bps: number) => `${(bps / 100).toFixed(bps % 100 === 0 ? 0 : 2)}%`;

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

export function dateTime(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export const shortHash = (hash: string, size = 8) =>
  hash.length <= size * 2 + 1 ? hash : `${hash.slice(0, size)}…${hash.slice(-size)}`;

/** Long implicit accounts and long sub-accounts, kept readable. */
export function shortAccount(id: string, max = 28): string {
  return id.length <= max ? id : `${id.slice(0, max - 10)}…${id.slice(-9)}`;
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
