const STAGES = [
  { days: 7, label: "7 days", title: "Raise", text: "Lenders fund a pinned build at fixed terms. The code freezes.", tone: "var(--yellow)", ink: "#000" },
  { days: 90, label: "90 days", title: "Repay", text: "Every sale pays lenders first. The principal stays in the business, and the operator cannot withdraw it.", tone: "var(--sage)", ink: "#000" },
  { days: 3, label: "3 days", title: "Grace", text: "Miss a payment and the operator's share goes to lenders. One payment clears it.", tone: "var(--accent)", ink: "#000" },
  { days: 7, label: "7 days", title: "Sell", text: "Anyone can foreclose. The business keeps earning for lenders while bidders compete for it.", tone: "#000", ink: "#f4f4f4" },
];

/** The life of a loan, drawn to scale: the bar itself is the diagram. */
export function HowItWorks() {
  return (
    <section id="how" className="px-[var(--margin)] py-[120px] lg:py-[180px]" aria-labelledby="how-title">
      <div className="lg:ml-[calc(42%-var(--margin))]">
        <h2 id="how-title" className="text-[length:var(--step-head)] leading-[1.05] font-medium tracking-[-0.02em]" data-reveal>The life of a loan, to scale</h2>
        <p className="mt-5 max-w-[56ch] text-[length:var(--step-body)]" data-reveal style={{ "--d": 1 } as React.CSSProperties}>
          A typical 90 day loan. A borrower who pays only ever sees the long sage stretch. Nobody needs a court, an admin or a keeper for the rest.
        </p>
      </div>
      <ol data-ui className="mt-14 flex flex-col gap-[6px] lg:h-[46svh] lg:flex-row">
        {STAGES.map((stage, i) => (
          <li
            key={stage.title}
            data-reveal="grow"
            className="min-h-[150px] overflow-hidden p-5 lg:min-h-0 lg:min-w-[16%]"
            style={{ flexGrow: stage.days, flexBasis: 0, background: stage.tone, color: stage.ink, "--d": i } as React.CSSProperties}
          >
            <p className="num text-[22px] font-medium">{stage.label}</p>
            <p className="mt-2 text-[28px] leading-tight font-medium tracking-[-0.01em]">{stage.title}</p>
            <p className="mt-2 max-w-[38ch] text-[16px] leading-snug">{stage.text}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}
