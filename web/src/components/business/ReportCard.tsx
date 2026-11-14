import { deployment } from "@/lib/config";
import { FLAG_TEXT, parseReport } from "@/lib/report";
import { VERDICT_TEXT, verdictOf, type Verdict } from "@/lib/risk";

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

export function ReportCard({ raw }: { raw: string | null }) {
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
        <ul className="list-disc space-y-1 pl-5 text-[15px]">
          {report.flags.map((flag) => <li key={flag}>{FLAG_TEXT[flag] ?? flag.replaceAll("_", " ")}</li>)}
        </ul>
      ) : <p className="text-[15px]">Nothing unusual was found.</p>}
      {LIEN_OWN.has(report.target) ? (
        <p className="rounded-[10px] bg-[var(--surface-2)] p-3 text-[14px] leading-snug text-[var(--ink-2)]" data-testid="lien-own-note">
          The Lien registry and the test-dollar token are still upgradeable by the team on the test network, which is why they score {level === "low" ? "as they do" : report.level.toLowerCase()}. Business accounts like this one have no keys at all.
        </p>
      ) : null}
      {report.verdict ? (
        <div className="text-[15px]" data-testid="ai-verdict">
          <p className="muted text-[13px]">AI verdict, from a private model on NEAR AI Cloud</p>
          <p className="italic">{report.verdict}</p>
        </div>
      ) : null}
    </div>
  );
}
