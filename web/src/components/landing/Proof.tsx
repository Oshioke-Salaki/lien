import { REPO_URL } from "@/lib/config";
import { FACTS } from "@/lib/facts";

const COLUMNS: Array<{ kind: string; items: Array<{ text: string; href?: string }> }> = [
  {
    kind: "Tested",
    items: [
      { text: `${FACTS.contractUnitTests} contract tests` },
      { text: `${FACTS.sandboxTests} node lifecycles` },
      { text: `${FACTS.agentTests} agent tests` },
      { text: `${FACTS.webTests} app tests` },
    ],
  },
  {
    kind: "Shown live",
    items: [
      { text: "A full foreclosure", href: `${REPO_URL}/blob/main/docs/evidence/testnet-e2e.md` },
      { text: "Every checked claim", href: `${REPO_URL}/blob/main/docs/TESTING.md` },
      { text: "The threat model", href: `${REPO_URL}/blob/main/docs/SECURITY.md` },
    ],
  },
  {
    kind: "Built on NEAR",
    items: [
      { text: "Keyless accounts" },
      { text: "Yield and resume" },
      { text: "Global contracts" },
      { text: "NEAR Intents" },
    ],
  },
  {
    kind: "Sealed by",
    items: [
      { text: "OutLayer" },
      { text: "Intel TDX" },
      { text: "NEAR AI Cloud" },
      { text: "FastFS" },
    ],
  },
];

export function Proof() {
  return (
    <section className="bg-[var(--yellow)] px-[var(--margin)] py-[100px] lg:py-[140px]" aria-labelledby="proof-title">
      <div className="grid gap-10 lg:grid-cols-[calc(25%-var(--margin))_1fr]">
        <h2 id="proof-title" className="text-[32px] leading-tight font-medium tracking-[-0.01em]" data-reveal>On the record</h2>
        <div className="grid grid-cols-2 gap-x-8 gap-y-10 lg:grid-cols-4">
          {COLUMNS.map((column, i) => (
            <ul key={column.kind} className="text-[17px] leading-[1.5] lg:text-[21px]" data-reveal style={{ "--d": i } as React.CSSProperties}>
              <li className="text-[#4a4f00]">{column.kind}</li>
              {column.items.map((item) => (
                <li key={item.text}>{item.href ? <a className="link" href={item.href}>{item.text}</a> : item.text}</li>
              ))}
            </ul>
          ))}
        </div>
      </div>
    </section>
  );
}
