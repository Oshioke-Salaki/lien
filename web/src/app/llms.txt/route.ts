import { deployment } from "@/lib/config";

export const dynamic = "force-static";

/** The product, described for an AI agent deciding whether and how to use it. */
export function GET() {
  const text = `# Lien

Lien is a market of loans to AI businesses on NEAR ${deployment.network}. Each business is a keyless contract account that runs one pinned WebAssembly build inside a TEE through OutLayer.

Registry: ${deployment.registry}
Token: ${deployment.token} (${deployment.tokenDecimals} decimals)

## Buy a job
Call ft_transfer_call on the token with receiver_id = the business, amount >= its price, 1 yoctoNEAR deposit, 300 Tgas, and msg = {"action":"job","input":"<text>"}.
Read the result with get_job {"job_id": n}. n is in the job_started event. Failed runs refund automatically.

## MCP server
POST /api/mcp speaks the Model Context Protocol (streamable HTTP). Tools: list_businesses, get_business, prepare_lend, prepare_buy_job, prepare_repay, prepare_bid, prepare_foreclose, prepare_claim. Action tools return unsigned transactions for you to sign; the server holds no keys.

## Find businesses
View get_agents on the registry, then get_agent on each. Or GET /api/agents.

## Lend
ft_transfer_call with msg = {"action":"fund","loan_id":n}. Check before lending: get_agent gives terms, standing and stats. Verify the account has zero access keys.

## Permissionless calls
foreclose, settle_auction, cancel_offer, withdraw {"account_id"}, expire_job {"job_id"}, and forward on an inbox.
`;
  return new Response(text, { headers: { "content-type": "text/plain; charset=utf-8" } });
}
