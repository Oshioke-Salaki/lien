// Checks the signature NEAR's Agent Market puts on every webhook it sends.
//
// From https://market.near.ai/skill/reference/webhooks.md, "Headers":
//   X-Market-Timestamp: Unix seconds, mixed into the signed material
//   X-Market-Signature: sha256=<hex HMAC-SHA256(secret, "<timestamp>.<raw body>")>
// The signed material is the literal bytes `<ascii timestamp>.<raw body>`, so the body
// is hashed exactly as it arrived, never re-serialized. The docs suggest refusing a
// timestamp more than 300 seconds away from now; we do.

import { createHmac, timingSafeEqual } from "node:crypto";

export const SIGNATURE_HEADER = "x-market-signature";
export const TIMESTAMP_HEADER = "x-market-timestamp";
export const EVENT_HEADER = "x-market-event";
export const DELIVERY_HEADER = "x-market-delivery";

/** How far a webhook's timestamp may be from our clock, in seconds. */
export const MAX_SKEW_SECONDS = 300;

/** The header value the marketplace would send for this body: `sha256=<hex>`. */
export function sign(secret: string, timestamp: string, rawBody: Uint8Array | string): string {
  const body = typeof rawBody === "string" ? Buffer.from(rawBody, "utf8") : Buffer.from(rawBody);
  const mac = createHmac("sha256", secret).update(Buffer.from(`${timestamp}.`, "ascii")).update(body).digest("hex");
  return `sha256=${mac}`;
}

export type SignatureInput = {
  secret: string | undefined;
  timestamp: string | null;
  signature: string | null;
  rawBody: Uint8Array | string;
  /** Unix seconds; defaults to the clock. */
  now?: number;
};

/** True only for a body signed with our secret, inside the time window. Constant-time compare. */
export function verifySignature({ secret, timestamp, signature, rawBody, now = Math.floor(Date.now() / 1000) }: SignatureInput): boolean {
  if (!secret || !timestamp || !signature) return false;
  if (!/^\d{1,12}$/.test(timestamp)) return false;
  if (Math.abs(now - Number(timestamp)) > MAX_SKEW_SECONDS) return false;
  if (!signature.startsWith("sha256=")) return false;
  const provided = signature.slice("sha256=".length).trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(provided)) return false;
  const expected = sign(secret, timestamp, rawBody).slice("sha256=".length);
  // Both are 64 hex chars here, so the lengths match and timingSafeEqual cannot throw.
  return timingSafeEqual(Buffer.from(expected, "ascii"), Buffer.from(provided, "ascii"));
}
