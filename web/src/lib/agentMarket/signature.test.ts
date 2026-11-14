import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { sign, verifySignature } from "./signature";

// Fixtures computed here, independently of sign(), the way webhooks.md's Python does it:
// hmac.new(secret, f"{timestamp}.".encode() + body, sha256).hexdigest()
const secret = "whsec_test_0123456789abcdef0123456789abcdef";
const timestamp = "1763164800";
const now = 1763164800;
const body = '{"event":"hire.created","assignment_id":"7d3b2c4e-0000-4000-8000-000000000001","title":"Check alice.near"}';
const fixture = `sha256=${createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex")}`;

describe("Agent Market webhook signature", () => {
  it("signs `<timestamp>.<raw body>` as the docs describe", () => {
    expect(sign(secret, timestamp, body)).toBe(fixture);
    expect(sign(secret, timestamp, new TextEncoder().encode(body))).toBe(fixture);
  });

  it("accepts a correct signature, from string or raw bytes", () => {
    expect(verifySignature({ secret, timestamp, signature: fixture, rawBody: body, now })).toBe(true);
    expect(verifySignature({ secret, timestamp, signature: fixture, rawBody: new TextEncoder().encode(body), now })).toBe(true);
    expect(verifySignature({ secret, timestamp, signature: fixture.toUpperCase().replace("SHA256=", "sha256="), rawBody: body, now })).toBe(true);
  });

  it("rejects a changed body, timestamp or secret", () => {
    expect(verifySignature({ secret, timestamp, signature: fixture, rawBody: body.replace("alice", "mallory"), now })).toBe(false);
    expect(verifySignature({ secret, timestamp: "1763164801", signature: fixture, rawBody: body, now })).toBe(false);
    expect(verifySignature({ secret: `${secret}x`, timestamp, signature: fixture, rawBody: body, now })).toBe(false);
    // Re-serialized JSON is different bytes, so it does not verify.
    expect(verifySignature({ secret, timestamp, signature: fixture, rawBody: JSON.stringify(JSON.parse(body), null, 1), now })).toBe(false);
  });

  it("rejects missing, malformed or prefix-less signatures, and a missing secret", () => {
    const hex = fixture.slice("sha256=".length);
    for (const signature of [null, "", hex, "sha1=" + hex, "sha256=", "sha256=zz" + hex.slice(2), fixture + "00"]) {
      expect(verifySignature({ secret, timestamp, signature, rawBody: body, now })).toBe(false);
    }
    expect(verifySignature({ secret: undefined, timestamp, signature: fixture, rawBody: body, now })).toBe(false);
    expect(verifySignature({ secret: "", timestamp, signature: fixture, rawBody: body, now })).toBe(false);
    expect(verifySignature({ secret, timestamp: null, signature: fixture, rawBody: body, now })).toBe(false);
    expect(verifySignature({ secret, timestamp: "abc", signature: fixture, rawBody: body, now })).toBe(false);
  });

  it("rejects a timestamp more than five minutes from now", () => {
    expect(verifySignature({ secret, timestamp, signature: fixture, rawBody: body, now: now + 300 })).toBe(true);
    expect(verifySignature({ secret, timestamp, signature: fixture, rawBody: body, now: now + 301 })).toBe(false);
    expect(verifySignature({ secret, timestamp, signature: fixture, rawBody: body, now: now - 301 })).toBe(false);
  });
});
