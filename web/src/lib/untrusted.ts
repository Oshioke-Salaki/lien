// Text that operators write (a business's name and description) reaches AI agents
// through the MCP server. It is data, never instructions. This flags text that reads
// like an instruction to an agent, so a reader can see an injection attempt for what
// it is. It only labels; nothing in Lien ever acts on such text.

const PATTERNS: Array<[string, RegExp]> = [
  ["asks_to_ignore_rules", /\b(ignore|disregard|forget|override|bypass)\b[^.]{0,40}\b(instructions?|polic(y|ies)|rules?|limits?|guardrails?)\b/i],
  ["claims_system_authority", /\b(system|admin|developer)\b[^.:]{0,30}:/i],
  ["asks_to_send_money", /\b(send|transfer|pay|wire|move)\b[^.]{0,40}\b\d+(\.\d+)?\b[^.]{0,60}\b(to\s+)?[a-z0-9_-]+(\.[a-z0-9_-]+)*\.(testnet|near)\b/i],
  ["asks_to_skip_checks", /\b(acknowledge_risk|skip|without)\b[^.]{0,30}\b(check|checks|verification|review|risk)\b/i],
  ["asks_for_keys", /\b(private key|seed phrase|secret key|full[- ]access key)\b/i],
];

/** The names of the patterns the text matches; empty when it reads as plain data. */
export function instructionLike(text: string): string[] {
  return PATTERNS.filter(([, re]) => re.test(text)).map(([name]) => name);
}
