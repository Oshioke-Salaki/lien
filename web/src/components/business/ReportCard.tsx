import { FLAG_TEXT, parseReport } from "@/lib/report";

export function ReportCard({ raw }: { raw: string | null }) {
  const report = parseReport(raw);
  if (!report) return raw ? <pre className="overflow-x-auto text-[13px] whitespace-pre-wrap">{raw}</pre> : <p className="muted">No report.</p>;
  return (
    <div className="space-y-2" data-testid="report">
      <p className="text-[15px]">
        <span className="font-medium">{report.target}</span>
        <span className="muted"> on {report.network}</span>
      </p>
      <p className="text-[22px] leading-tight font-medium capitalize">{report.level} risk <span className="num text-[15px] font-normal muted">score {report.score} of 100</span></p>
      {report.flags.length ? (
        <ul className="space-y-1 text-[15px]">
          {report.flags.map((flag) => <li key={flag}>{FLAG_TEXT[flag] ?? flag.replaceAll("_", " ")}</li>)}
        </ul>
      ) : <p className="text-[15px]">Nothing unusual was found.</p>}
      {report.verdict ? <p className="text-[15px] italic">{report.verdict}</p> : null}
    </div>
  );
}
