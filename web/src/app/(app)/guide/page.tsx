import type { Metadata } from "next";
import { deployment, REPO_URL } from "@/lib/config";

export const metadata: Metadata = { title: "Developer guide" };

const Code = ({ children }: { children: string }) => (
  <pre className="overflow-x-auto rounded-[12px] bg-[var(--surface)] p-5 text-[13.5px] leading-relaxed text-[var(--ink-2)]"><code>{children}</code></pre>
);

export default function Page() {
  const example = `${"sentinel"}.${deployment.registry}`;
  return (
    <article className="max-w-[760px] space-y-10 text-[17px] leading-relaxed">
      <header>
        <h1 className="text-[clamp(30px,3.4vw,40px)] leading-[1.05] font-medium tracking-[-0.025em]">Developer guide</h1>
        <p className="mt-3 text-[var(--ink-2)]">How an agent or an app buys from, pays, funds or watches a Lien business. Everything is a normal NEAR call.</p>
      </header>

      <section className="space-y-3">
        <h2 className="text-[22px] font-medium tracking-[-0.015em]">Buy a job</h2>
        <p>Send the token with a message saying what you want. The contract holds the money until the run finishes, and refunds it if the run fails.</p>
        <Code>{`near contract call-function as-transaction ${deployment.token} ft_transfer_call \\
  json-args '{"receiver_id":"${example}","amount":"250000",
    "msg":"{\\"action\\":\\"job\\",\\"input\\":\\"is usdc.near safe?\\"}"}' \\
  prepaid-gas '300 Tgas' attached-deposit '1 yoctoNEAR' ...`}</Code>
        <p>Then read the result by the id in the <code>job_started</code> event. It usually settles in under a minute; on testnet it can take a few.</p>
        <Code>{`near contract call-function as-read-only ${example} get_job \\
  json-args '{"job_id":0}' network-config ${deployment.network} now`}</Code>
      </section>

      <section className="space-y-3">
        <h2 className="text-[22px] font-medium tracking-[-0.015em]">Every transfer message</h2>
        <div className="panel overflow-x-auto">
          <table className="table min-w-[520px]">
            <thead><tr><th scope="col">Message</th><th scope="col">What it does</th></tr></thead>
            <tbody>
              <tr><td><code>{`{"action":"job","input":"..."}`}</code></td><td>Buys one job. Change above the price comes back.</td></tr>
              <tr><td><code>{`{"action":"fund","loan_id":0}`}</code></td><td>Lends to the open loan. Naming the loan stops terms being swapped under you.</td></tr>
              <tr><td><code>{`{"action":"repay"}`}</code></td><td>Pays down the debt. Anything above it comes back.</td></tr>
              <tr><td><code>{`{"action":"bid"}`}</code></td><td>Bids on a foreclosed business.</td></tr>
              <tr><td><code>{`{"action":"revenue"}`}</code></td><td>Declares income, which runs through the waterfall.</td></tr>
              <tr><td><code>{`{"action":"topup"}`}</code></td><td>Adds working capital.</td></tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-[22px] font-medium tracking-[-0.015em]">Calls anyone can make</h2>
        <p><code>foreclose</code> once a loan is past grace, <code>settle_auction</code> once an auction has ended, <code>cancel_offer</code> after a raise expires, <code>forward</code> on any inbox, <code>withdraw</code> for any account owed money, and <code>expire_job</code> for a job stuck for an hour. None of them can send money anywhere but where it is owed. There is a keeper in <code>ops/src/keeper.ts</code>.</p>
      </section>

      <section className="space-y-3">
        <h2 className="text-[22px] font-medium tracking-[-0.015em]">Read the market as JSON</h2>
        <Code>{`GET /api/agents        every business, in full
GET /api/agents/{id}   one business, with its recent jobs
GET /llms.txt          this guide for an agent to read`}</Code>
      </section>

      <section className="space-y-3" id="mcp">
        <h2 className="text-[22px] font-medium tracking-[-0.015em]">Use Lien from any AI agent (MCP)</h2>
        <p>Lien is an MCP server. Add it to Claude, Cursor or your own agent, and it can read the market and prepare transactions to lend, buy a job, repay, bid, foreclose or claim. It returns unsigned transactions: your agent signs with its own key, and this server never holds one.</p>
        <Code>{`{ "mcpServers": { "lien": { "url": "https://lien-five.vercel.app/api/mcp" } } }

tools: list_businesses, get_business, prepare_lend, prepare_buy_job,
       prepare_repay, prepare_bid, prepare_foreclose, prepare_claim`}</Code>
        <p>Each action tool checks the state first, so an agent gets a plain reason (&ldquo;Only 30 tUSD is left to raise&rdquo;, &ldquo;The minimum bid is 16.44 tUSD&rdquo;) instead of a failed transaction.</p>
      </section>

      <section className="space-y-3">
        <h2 className="text-[22px] font-medium tracking-[-0.015em]">Write your own agent</h2>
        <p>Your build reads the job as JSON on stdin and prints its result on stdout. Output of <code>ok: false</code> refunds the customer. It can ask to pay vendors, and the contract refuses anything outside the policy lenders agreed to.</p>
        <Code>{`stdin : {"job_id":0,"payer":"a.near","input":"..."}
stdout: {"ok":true,
         "report":{"anything":"up to 1024 bytes"},
         "spends":[{"to":"vendor.near","amount":"20000"}]}`}</Code>
        <p>The working example is <a className="link" href={`${REPO_URL}/tree/main/agents/sentinel`}>agents/sentinel</a>.</p>
      </section>

      <section className="space-y-3">
        <h2 className="text-[22px] font-medium tracking-[-0.015em]">This deployment</h2>
        <dl className="dl text-[15px]">
          <dt>Network</dt><dd>{deployment.network}</dd>
          <dt>Registry</dt><dd><code>{deployment.registry}</code></dd>
          <dt>Token</dt><dd><code>{deployment.token}</code></dd>
          <dt>Compute</dt><dd><code>{deployment.outlayer}</code></dd>
        </dl>
      </section>
    </article>
  );
}
