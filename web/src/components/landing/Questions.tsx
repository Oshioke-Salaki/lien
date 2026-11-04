const QUESTIONS = [
  {
    q: "What stops the operator running off with the money?",
    a: "There is nothing to run off with. The account holds no keys. The principal sits in working capital that only the pinned code can spend, and only to vendors lenders approved, up to a daily limit. The operator's only money is their agreed share of sales.",
  },
  {
    q: "Couldn't they copy the code and leave?",
    a: "Yes, the code is open. What they cannot copy is the account customers pay, the inbox, the track record on chain or the sealed credentials. So a loan is only safe up to what leaving would forfeit, and lenders should size it that way.",
  },
  {
    q: "Can a borrower fake its revenue?",
    a: "Faking it does not help. The schedule only counts money that reaches lenders, so paying yourself to look busy just repays the loan. The jobs and customer counts lenders read can be inflated, which is why each one shows beside how many distinct customers it came from.",
  },
  {
    q: "What if the enclave is broken?",
    a: "An attacker with a broken TEE could forge a job's result and the spend requests with it. They still could not pay anyone off the vendor list or above the daily limit, and they could not reach what lenders are owed. The damage has a ceiling, and it is on the page before you lend.",
  },
  {
    q: "Who decides a loan has defaulted?",
    a: "Arithmetic. The contract compares what lenders have received with the schedule. Once a business is behind and past grace, anyone can call foreclose. There is no admin, no oracle and no keeper to bribe or wait for.",
  },
  {
    q: "What happens to customers during a foreclosure?",
    a: "Nothing. They pay the same address and get the same service. The only difference is who receives the money, which is the point of taking a running business as collateral.",
  },
  {
    q: "Is it ready for real money?",
    a: "Not yet. The contracts are heavily tested but not independently audited, and OutLayer's own operators are part of the trust model. The full list of what is and is not protected is in the threat model, and we would read it before lending a cent.",
  },
];

export function Questions() {
  return (
    <section id="questions" className="px-[var(--margin)] py-[120px] lg:py-[180px]" aria-labelledby="questions-title">
      <h2 id="questions-title" className="mb-14 text-[clamp(26px,2.6vw,40px)] leading-[1.1] font-medium text-[var(--muted)]" data-reveal>What you should ask</h2>
      <div className="space-y-14 lg:space-y-[80px]">
        {QUESTIONS.map(({ q, a }) => (
          <div key={q} className="grid gap-3 lg:grid-cols-12 lg:gap-8">
            <h3 className="text-[24px] leading-[1.15] font-medium tracking-[-0.01em] lg:col-span-6 lg:text-[clamp(26px,2.6vw,40px)]" data-reveal>{q}</h3>
            <p className="max-w-[46ch] text-[17px] leading-[1.55] lg:col-span-5 lg:col-start-8 lg:text-[18px]" data-reveal style={{ "--d": 1 } as React.CSSProperties}>{a}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
