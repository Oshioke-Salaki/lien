import { FLAG_TEXT, parseReport } from "@/lib/report";

/** What a risk level means for the person deciding whether to pay. */
const MEANING: Record<string, string> = {
  low: "Low risk: nothing stands out.",
  medium: "Medium risk: check who controls this account before paying it.",
  high: "High risk: think twice before paying this account.",
};

export function ReportCard({ raw }: { raw: string | null }) {
  const report = parseReport(raw);
  if (!report) return raw ? <pre className="overflow-x-auto text-[13px] whitespace-pre-wrap">{raw}</pre> : <p className="muted">No report.</p>;
  const level = report.level.toLowerCase();
  return (
    <div className="space-y-2" data-testid="report">
      <p className="text-[15px]">
        <span className="font-medium break-all">{report.target}</span>
        <span className="muted"> on {report.network}</span>
      </p>
      <p className="text-[22px] leading-tight font-medium">{report.level[0]!.toUpperCase()}{report.level.slice(1)} risk <span className="num text-[15px] font-normal muted">score {report.score} of 100, higher is riskier</span></p>
      {report.flags.includes("account_does_not_exist")
        ? <p className="text-[15px]">No such account on NEAR: don&rsquo;t send anything to it.</p>
        : MEANING[level] ? <p className="text-[15px]">{MEANING[level]}</p> : null}
      {report.flags.length ? (
        <ul className="list-disc space-y-1 pl-5 text-[15px]">
          {report.flags.map((flag) => <li key={flag}>{FLAG_TEXT[flag] ?? flag.replaceAll("_", " ")}</li>)}
        </ul>
      ) : <p className="text-[15px]">Nothing unusual was found.</p>}
      {report.verdict ? <p className="text-[15px] italic">{report.verdict}</p> : null}
    </div>
  );
}
