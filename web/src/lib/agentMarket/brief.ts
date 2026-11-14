// Finds the NEAR account a buyer wants checked in a free-text job brief.
//
// risk.ts parseTarget (the port of risk.rs) treats the bare words "near" and "testnet"
// as accounts, which is right for Sentinel's one-line input but wrong for a brief such
// as "Check the NEAR account alice.near". Here only a named account (a dotted name ending
// in .near or .testnet) or a 64-hex implicit account counts, and the suffix picks the
// network. A brief is someone else's text: only the validated account id leaves this file.

import type { Network } from "../config";

export type Target = { accountId: string; network: Network };

// A named account: dot-separated parts of [a-z0-9] joined by single - or _, ending in .near
// or .testnet. Not preceded by an id character, and not followed by more of a host
// name (so market.near.ai is not read as market.near).
const NAMED = /(?<![a-z0-9_.-])((?:[a-z0-9]+(?:[-_][a-z0-9]+)*\.)+(near|testnet))(?![a-z0-9_-]|\.[a-z0-9])/g;
const IMPLICIT = /(?<![0-9a-z])([0-9a-f]{64})(?![0-9a-z])/g;

export function isAccountId(id: string): boolean {
  return id.length >= 2 && id.length <= 64 && /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/.test(id);
}

/** The first account id in the text, or null. An implicit account is on mainnet unless the text says testnet. */
export function parseBrief(text: string): Target | null {
  const lower = text.toLowerCase();
  const found: Array<{ index: number; target: Target }> = [];
  for (const m of lower.matchAll(NAMED)) {
    const id = m[1]!;
    if (isAccountId(id)) found.push({ index: m.index, target: { accountId: id, network: m[2] === "near" ? "mainnet" : "testnet" } });
  }
  for (const m of lower.matchAll(IMPLICIT)) {
    found.push({ index: m.index, target: { accountId: m[1]!, network: /\btestnet\b/.test(lower) ? "testnet" : "mainnet" } });
  }
  found.sort((a, b) => a.index - b.index);
  return found[0]?.target ?? null;
}

/** The first account in any of the texts, in order: a buyer's newest message before the original brief. */
export function parseBriefs(...texts: Array<string | null | undefined>): Target | null {
  for (const text of texts) {
    const target = text ? parseBrief(text) : null;
    if (target) return target;
  }
  return null;
}
