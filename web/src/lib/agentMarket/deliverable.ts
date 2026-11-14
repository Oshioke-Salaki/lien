// The Markdown a buyer on NEAR's Agent Market receives from Sentinel.
//
// Rendering is deterministic (no clock, no random): the marketplace treats a resubmit of
// byte-identical Markdown as a no-op, so a retried webhook or a poll that races it cannot
// stack up versions while the chain state is unchanged.

import { deployment, REPO_URL, RPC_URLS, type Network } from "../config";
import { FLAG_TEXT } from "../report";
import { VERDICT_TEXT, type Assessment, type Facts } from "../risk";

export const APP_URL = "https://lien-five.vercel.app";
export const SENTINEL_ID = "sentinel.v1.lien-13569.testnet";
export const SENTINEL_URL = `${APP_URL}/b/${SENTINEL_ID}`;

const EXPLORER: Record<Network, string> = { mainnet: "https://nearblocks.io", testnet: "https://testnet.nearblocks.io" };

const flagText = (flag: string) => FLAG_TEXT[flag] ?? `${flag.replaceAll("_", " ")}.`;
const yesNo = (value: boolean) => (value ? "yes" : "no");

export type DeliverableInput = { accountId: string; network: Network; facts: Facts; assessment: Assessment };

export function renderDeliverable({ accountId, network, facts, assessment }: DeliverableInput): string {
  const hash = deployment.sentinel?.hash ?? "";
  const rpc = RPC_URLS[network][0];
  const explorer = `${EXPLORER[network]}/address/${accountId}`;
  const flags = assessment.flags.length
    ? assessment.flags.map((f) => `- **${f}**: ${flagText(f)}`).join("\n")
    : "- None. Nothing in the rules below stood out.";
  const call = (requestType: string) =>
    `curl -s ${rpc} -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"query","params":{"request_type":"${requestType}","finality":"optimistic","account_id":"${accountId}"}}'`;

  return `# Sentinel risk check: \`${accountId}\`

| | |
|---|---|
| Account | \`${accountId}\` |
| Network | NEAR ${network} |
| Score | **${assessment.score} / 100** (0 is safest) |
| Level | ${assessment.level} |
| Verdict | **${assessment.verdict}** |

**${assessment.verdict}** means: ${VERDICT_TEXT[assessment.verdict]}

## Flags

${flags}

## Facts read from the chain

| Fact | Value |
|---|---|
| Account exists | ${yesNo(facts.exists)} |
| Full-access keys | ${facts.fullAccessKeys} |
| Function-call keys | ${facts.functionCallKeys} |
| Contract deployed | ${yesNo(facts.hasContract)} |
| Balance | ${facts.balanceNear} NEAR (whole NEAR, rounded down) |
| Storage used | ${facts.storageBytes} bytes |

## How this was computed

The score adds fixed points per rule and is capped at 100: account missing +90; a contract whose owner still holds a full-access key +40; no keys and no code +50; more than three full-access keys +20; under 1 NEAR +15; a contract under 50,000 bytes of storage +10. Level is low (0-19), medium (20-49) or high (50-100), and the verdict follows the level: low is ALLOW, medium is WARN, high is BLOCK.

These are the same rules as Sentinel's pinned build \`${hash.slice(0, 8)}…\` (full hash \`${hash}\`), which runs attested in Intel TDX on OutLayer. Here they were run by Lien's server, from a TypeScript port tested against the Rust cases ([risk.rs](${REPO_URL}/blob/main/agents/sentinel/src/risk.rs), [risk.ts](${REPO_URL}/blob/main/web/src/lib/risk.ts)), on chain state read at optimistic finality when this job was delivered.

## Want it attested and on chain?

Buy the same check from Sentinel on Lien: ${SENTINEL_URL}. That version runs inside the TEE, and its report and attestation are recorded on NEAR testnet.

## Check it yourself

- Explorer: ${explorer}
- The same two RPC reads Sentinel makes:

\`\`\`sh
${call("view_account")}
${call("view_access_key_list")}
\`\`\`

\`code_hash\` of \`11111111111111111111111111111111\` means no contract. \`amount\` is in yoctoNEAR (10^24 per NEAR).
`;
}

/** Sent with the decline when the brief names no account; the buyer is refunded in full. */
export const NO_ACCOUNT_DETAIL =
  "Sentinel checks one NEAR account per job, and I could not find a NEAR account id in this brief. " +
  "Please hire again with the account in the brief, for example alice.near (mainnet) or bob.testnet (testnet). " +
  "This job has been declined so you are refunded in full.";
