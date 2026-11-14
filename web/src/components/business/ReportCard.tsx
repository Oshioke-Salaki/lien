import Link from "next/link";
import { deployment } from "@/lib/config";
import { AI_SAMPLE } from "@/lib/demo";
import type { Report } from "@/lib/near/types";
import { explainFlag, FLAG_POINTS, parseReport } from "@/lib/report";
import { VERDICT_TEXT, verdictOf, type Verdict } from "@/lib/risk";

/** Whether the business that ran the check has the AI verdict on, and whether a loan is open. */
export type AiContext = { on: boolean; loanOpen: boolean };

/** Lien's own shared accounts: still upgradeable by the team on the test network. */
const LIEN_OWN = new Set([deployment.registry, deployment.token]);

/** What a risk level means for the person deciding whether to pay. */
const MEANING: Record<string, string> = {
  low: "Low risk: nothing stands out.",
  medium: "Medium risk: check who controls this account before paying it.",
  high: "High risk: think twice before paying this account.",
};

const VERDICT_COLOR: Record<Verdict, string> = { ALLOW: "var(--ok)", WARN: "var(--warn)", BLOCK: "var(--danger)" };

/** The decision the score maps to: low allows, medium warns, high blocks (thresholds in lib/risk.ts). */
export function VerdictBadge({ verdict }: { verdict: Verdict }) {
  return (
    <span
      data-testid="verdict"
      title={VERDICT_TEXT[verdict]}
      className="inline-flex items-center rounded-full border px-2.5 py-0.5 text-[12px] font-semibold tracking-[0.08em]"
      style={{ color: VERDICT_COLOR[verdict], borderColor: VERDICT_COLOR[verdict] }}
    >
      {verdict}
    </span>
  );
}

export function ReportCard({ raw, ai }: { raw: string | null; ai?: AiContext }) {
  const report = parseReport(raw);
  if (!report) return raw ? <pre className="overflow-x-auto text-[13px] whitespace-pre-wrap">{raw}</pre> : <p className="muted">No report.</p>;
  const level = report.level.toLowerCase();
  // Nothing to grade: a name nobody owns is not "high risk", it is not there at all.
  if (report.flags.includes("account_does_not_exist")) {
    return (
      <div className="space-y-2" data-testid="report">
        <p className="text-[15px]"><span className="font-medium break-all">{report.target}</span><span className="muted"> on {report.network}</span></p>
        <VerdictBadge verdict="BLOCK" />
        <p className="text-[22px] leading-tight font-medium">No such account</p>
        <p className="text-[15px]">Nothing exists at this name on {report.network}. Check the spelling, and don&rsquo;t send anything to it.</p>
      </div>
    );
  }
  return (
    <div className="space-y-2" data-testid="report">
      <p className="text-[15px]">
        <span className="font-medium break-all">{report.target}</span>
        <span className="muted"> on {report.network}</span>
      </p>
      <p className="flex flex-wrap items-center gap-2">
        <VerdictBadge verdict={verdictOf(level)} />
        <span className="text-[14px] muted">Verdict, from the score: low allows, medium warns, high blocks</span>
      </p>
      <p className="text-[22px] leading-tight font-medium">{report.level[0]!.toUpperCase()}{report.level.slice(1)} risk <span className="num text-[15px] font-normal muted">score {report.score} of 100, higher is riskier</span></p>
      {MEANING[level] ? <p className="text-[15px]">{MEANING[level]}</p> : null}
      {report.flags.length ? (
        <ul className="space-y-2 text-[15px]" data-testid="report-flags">
          {report.flags.map((flag) => {
            const { found, means } = explainFlag(flag, report);
            const points = FLAG_POINTS[flag];
            return (
              <li key={flag} className="flex items-start justify-between gap-3 rounded-[10px] bg-[var(--surface-2)] px-3 py-2">
                <span className="min-w-0 leading-snug"><span className="font-medium">{found}</span>{means ? <span className="text-[var(--ink-2)]">: {means}</span> : null}</span>
                {points ? <span className="num shrink-0 text-[13px] muted" title="Points this adds to the score">+{points}</span> : null}
              </li>
            );
          })}
        </ul>
      ) : <p className="text-[15px]">Nothing unusual was found.</p>}
      {LIEN_OWN.has(report.target) ? (
        <p className="rounded-[10px] bg-[var(--surface-2)] p-3 text-[14px] leading-snug text-[var(--ink-2)]" data-testid="lien-own-note">
          The Lien registry and the test-dollar token are still upgradeable by the team on the test network, which is why they score {level === "low" ? "as they do" : report.level.toLowerCase()}. Business accounts like this one have no keys at all.
        </p>
      ) : null}
      <AiVerdict report={report} ai={ai} />
    </div>
  );
}

/** The AI's opinion when the business has it on; otherwise who has it, and why this one can't. */
function AiVerdict({ report, ai }: { report: Report; ai?: AiContext }) {
  if (report.verdict) {
    return (
      <div className="rounded-[12px] p-3 shadow-[inset_0_0_0_1px_var(--line)]" data-testid="ai-verdict">
        <p className="text-[13px] font-medium tracking-[0.02em] text-[var(--accent)]">AI verdict</p>
        <p className="mt-1 text-[15px] leading-snug">{report.verdict}</p>
        <p className="mt-2 text-[13px] muted">Written by a private model on NEAR AI Cloud from the facts above. The score and the BLOCK, WARN or ALLOW come from the fixed rules, not from the AI.</p>
      </div>
    );
  }
  const loanOpen = ai?.loanOpen ?? false;
  return (
    <div className="rounded-[12px] bg-[var(--surface-2)] p-3 text-[14px] leading-snug text-[var(--ink-2)]" data-testid="ai-verdict-off">
      <p className="font-medium text-[var(--ink)]">No AI verdict on this report</p>
      {report.verdict_error || ai?.on ? (
        <p className="mt-1">{report.verdict_error ? "The AI model did not answer this time, so this report carries the rule-based verdict only." : "This business has the AI verdict on, but this report was written without one, before it was turned on."}</p>
      ) : (
        <p className="mt-1">
          This business does not have it turned on. <Link className="link" href={`/b/${AI_SAMPLE}`}>Beacon</Link> does: a private model on NEAR AI Cloud adds a written opinion to each check.
          {loanOpen ? " A business can only turn it on with no loan open: while a loan is open its program and its secrets are frozen, so nobody can slip in a new key or new code. This one can add it once its loan is repaid." : ""}
        </p>
      )}
    </div>
  );
}
