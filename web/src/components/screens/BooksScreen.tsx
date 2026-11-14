"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { CodeBlock } from "@/components/CodeBlock";
import { AccountLink, EmptyState, ErrorState, Info, More, Panel, Skeleton } from "@/components/ui";
import { useLive } from "@/hooks/useLive";
import { KIND_LABEL, type Amount, type Books, type CustomerKind } from "@/lib/books";
import { accountUrl, deployment, EXPLORER, RPC_URLS, NETWORK } from "@/lib/config";
import { dateTime, percent, shortAccount } from "@/lib/format";

async function fetchBooks(id: string): Promise<Books> {
  const response = await fetch(`/api/books/${encodeURIComponent(id)}`, { signal: AbortSignal.timeout(25_000), cache: "no-store" });
  const body = (await response.json().catch(() => ({}))) as Books & { error?: string };
  if (!response.ok) throw new Error(body.error ?? "The network could not be reached.");
  return body;
}

const KIND_TONE: Record<CustomerKind, string> = {
  outside: "var(--ok)",
  guest: "var(--accent)",
  team: "var(--ink-2)",
  heartbeat: "#6b6158",
};

function Crumb({ id, name }: { id: string; name: string }) {
  return (
    <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-2 text-[14px] muted">
      <Link className="transition-colors hover:text-[var(--ink)]" href="/market">Market</Link>
      <span aria-hidden>/</span>
      <Link className="truncate transition-colors hover:text-[var(--ink)]" href={`/b/${id}`}>{name}</Link>
      <span aria-hidden>/</span>
      <span className="text-[var(--ink-2)]">Books</span>
    </nav>
  );
}

export function BooksScreen({ id, initial }: { id: string; initial?: Books }) {
  const live = useLive(() => fetchBooks(id), `books:${id}`, 15_000, initial);
  const short = id.split(".")[0]!;

  if (live.error && !live.data) {
    const missing = /no Lien business|Not a Lien business/i.test(live.error.message);
    return (
      <div className="space-y-6">
        <Crumb id={id} name={short} />
        <ErrorState message={missing ? `There is no Lien business at ${id}.` : "Books unreachable. Retrying automatically."} onRetry={missing ? undefined : () => void live.refresh()} />
        {missing ? <Link className="btn btn-secondary" href="/market">Back to the market</Link> : null}
      </div>
    );
  }

  if (!live.data) {
    return (
      <div className="space-y-6" aria-busy="true" data-testid="books-loading">
        <Crumb id={id} name={short} />
        <div className="space-y-3">
          <h1 className="text-[clamp(30px,3.4vw,40px)] leading-[1.05] font-medium tracking-[-0.025em]">Books</h1>
          <p className="text-[15px] muted">Reading the ledger, loans and sales at one block…</p>
        </div>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[104px]" />)}</div>
        <div className="grid grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-2"><Skeleton className="h-[420px]" /><Skeleton className="h-[420px]" /></div>
      </div>
    );
  }

  const books = live.data;
  return (
    <div className="space-y-6" data-testid="books">
      <div className="space-y-3">
        <Crumb id={id} name={books.name} />
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <h1 className="text-[clamp(30px,3.4vw,40px)] leading-[1.05] font-medium tracking-[-0.025em]">{books.name}&rsquo;s books</h1>
          <BalanceChip books={books} />
        </div>
        <p className="max-w-[68ch] text-[17px] leading-snug text-[var(--ink-2)]">
          Computed from its own contract at one block. Nobody can type or edit them.
        </p>
        <p className="text-[14px] muted" data-testid="books-block">
          {books.block ? <>Read at block <a className="link" href={`${EXPLORER}/blocks/${books.block.hash}`} target="_blank" rel="noreferrer">#{books.block.height.toLocaleString("en-US")}</a>, {dateTime(books.now)}.</> : <>Read {dateTime(books.now)}.</>}
          {" "}Refreshes every 15 seconds.
        </p>
      </div>

      <Headlines books={books} />

      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-5 lg:grid-cols-2">
        <IncomePanel books={books} />
        <BalancePanel books={books} />
      </div>
      <CustomersPanel books={books} />
      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-5 lg:grid-cols-2">
        <LoansPanel books={books} />
        <PolicyPanel books={books} />
      </div>
      <HowPanel books={books} />
    </div>
  );
}

function BalanceChip({ books }: { books: Books }) {
  const { check } = books.balance;
  const ok = check !== "short";
  return (
    <span className="chip" style={{ color: ok ? "var(--ok)" : "var(--danger)" }} data-testid="books-check" data-check={check}>
      <span aria-hidden className="chip-dot" />
      <span className="text-[var(--ink)]" title={check === "equal" ? "The token contract says this business holds exactly what its ledger records: every dollar is accounted for. The same check npm run verify runs." : check === "covers" ? "It holds more than its ledger records: someone sent it a plain transfer it never recorded." : "It holds less than its ledger records."}>{check === "equal" ? "Every dollar accounted for ✓" : check === "covers" ? "Balance covers the books ✓" : "Balance below the books"}</span>
    </span>
  );
}

function Tile({ label, value, sub, testid }: { label: string; value: ReactNode; sub?: ReactNode; testid?: string }) {
  return (
    <div className="min-w-0 rounded-[16px] bg-[var(--surface)] p-4 sm:p-5">
      <p className="text-[13px] muted sm:text-[14px]">{label}</p>
      <p className="num mt-1 text-[clamp(22px,3vw,32px)] leading-tight font-medium tracking-[-0.02em]" data-testid={testid}>{value}</p>
      {sub ? <p className="mt-1 text-[13px] text-[var(--ink-2)]">{sub}</p> : null}
    </div>
  );
}

function Headlines({ books }: { books: Books }) {
  const life = books.income.lifetime;
  const c = books.customers;
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Tile label="Sales, since it opened" value={life.sales.usd} sub={`${life.salesCount} ${life.salesCount === 1 ? "check" : "checks"} delivered`} testid="tile-sales" />
      <Tile label="Paid to lenders" value={life.lendersRepaid.usd} sub={books.loans.ran ? `on ${books.loans.ran} ${books.loans.ran === 1 ? "loan" : "loans"}` : books.loans.lines.some((l) => l.status === "Funding") ? "none yet: repayments start once its loan fills" : "it has not borrowed"} testid="tile-lenders" />
      <Tile label="Tokens it holds" value={books.balance.held.usd} sub={books.balance.check === "equal" ? "every unit accounted for" : books.balance.check === "covers" ? `${books.balance.difference.usd} above the books` : `${books.balance.difference.usd} short`} testid="tile-held" />
      <Tile label="Paying customers" value={c.uniqueLifetime} sub={c.complete ? `${c.visitors} outside visitors, ${c.team} team` : `${c.counted} in the last ${c.jobsInRecords} jobs`} testid="tile-customers" />
    </div>
  );
}

/** One line of a statement: label, lifetime figure, 7-day figure. */
function Row({ label, tip, life, week, strong, testid }: { label: ReactNode; tip?: string; life: ReactNode; week?: ReactNode; strong?: boolean; testid?: string }) {
  return (
    <tr data-testid={testid}>
      <th scope="row" className={`py-[10px] pr-3 text-left align-top text-[15px] font-normal ${strong ? "text-[var(--ink)]" : "text-[var(--ink-2)]"}`}>
        {label}{tip ? <Info label={typeof label === "string" ? label : "this line"} tip={tip} /> : null}
      </th>
      <td className={`num py-[10px] pl-2 text-right align-top whitespace-nowrap ${strong ? "font-medium" : ""}`}>{life}</td>
      <td className="num py-[10px] pl-3 text-right align-top whitespace-nowrap text-[var(--ink-2)]">{week ?? <span className="muted" title="Not recorded per day on chain">—</span>}</td>
    </tr>
  );
}

function Section({ children }: { children: ReactNode }) {
  return <tr><th colSpan={3} scope="colgroup" className="pt-4 pb-1 text-left text-[12px] font-medium tracking-[0.08em] text-[var(--muted)] uppercase">{children}</th></tr>;
}

function IncomePanel({ books }: { books: Books }) {
  const life = books.income.lifetime;
  const week = books.income.last7;
  const weekOr = (value: ReactNode) => (week.complete ? value : <span className="muted" title="Older job records were dropped by the contract">n/a</span>);
  return (
    <Panel title="Income statement" aside={<span className="num">since it opened · last 7 days</span>} id="income">
      <table className="w-full table-fixed border-collapse" data-testid="income">
        <colgroup><col /><col className="w-[96px] sm:w-[110px]" /><col className="w-[84px] sm:w-[100px]" /></colgroup>
        <thead className="sr-only"><tr><th scope="col">Line</th><th scope="col">Since it opened</th><th scope="col">Last 7 days</th></tr></thead>
        <tbody className="divide-y divide-[var(--line)]">
          <Section>Money in</Section>
          <Row strong label={`Sales (${life.salesCount} delivered)`} tip="Payments for checks the business delivered. A payment is held until the check finishes and only then counts as a sale." life={life.sales.usd} week={weekOr(week.sales.usd)} testid="income-sales" />
          <Row label="Other income, through its inbox" tip="Money paid to the business from elsewhere, including other blockchains, recorded by the contract as revenue." life={life.otherIncome.usd} />
          <Row label={`Refunded to buyers (${life.refundsCount})`} tip="Checks that could not finish. The buyer got the whole payment back, so a refund is never income." life={life.refunds ? life.refunds.usd : <span className="muted">{life.refundsCount} checks</span>} week={weekOr(week.refunds.usd)} testid="income-refunds" />
          <Section>Money out</Section>
          <Row label="Paid to lenders" tip="Everything that reached lenders on every loan that ran: their share of each sale, direct repayments, and anything taken over or sold for them." life={life.lendersRepaid.usd} testid="income-lenders" />
          <Row label="Vendors, under the spend policy" tip="What the business's own code paid its approved vendors, each payment within the caps below." life={life.vendorPayments.usd} />
          <Row label="Compute, paid to OutLayer" tip={`Paid in NEAR, not dollars, from the compute budget: each run attaches ${books.income.compute.depositPerRunNear} NEAR and OutLayer returns what it did not use. The contract does not record the cost of each run, so no figure is shown.`} life={<span className="muted">in NEAR</span>} />
          <Section>Kept, as it stands now</Section>
          <Row label="Owner's share, not withdrawn" tip="The owner's part of sales still held by the business. The contract does not count past withdrawals, so a lifetime figure cannot be derived." life={life.ownerShareNow.usd} />
          <Row label="Running money" tip="Working capital: the loan's principal and the kept part of each sale, less what the code spent." life={life.runningMoneyNow.usd} />
        </tbody>
      </table>
      <p className="mt-3 text-[13px] muted">
        {week.salesCount} {week.salesCount === 1 ? "sale" : "sales"} to {week.customers} {week.customers === 1 ? "customer" : "customers"} in 7 days.
        {books.income.salesMatchCounter === true ? " Job records match the contract's counters." : ""}
        <Info label="dashes" tip="A dash means the chain keeps that figure only as a lifetime total, so a 7-day amount cannot be computed exactly." />
      </p>
    </Panel>
  );
}

function BalancePanel({ books }: { books: Books }) {
  const bal = books.balance;
  const parts: Array<{ key: string; value: Amount; color: string; tip: string }> = [
    { key: "Owed to lenders", value: bal.owedToLenders, color: "var(--accent)", tip: "Repaid to lenders and not yet collected by them, plus any money lent to a loan that is still raising." },
    { key: "Owner's share", value: bal.ownerShare, color: "var(--ink-2)", tip: "The owner's earned share. Locked while the business is behind on payments." },
    { key: "Running money", value: bal.runningMoney, color: "#6b6158", tip: "Working capital the business's own code spends within its policy." },
    { key: "Held for refunds and bids", value: bal.heldForOthers, color: "var(--warn)", tip: "Payments for checks still running, the standing auction bid, and money being paid out to specific accounts." },
  ];
  const total = BigInt(bal.ledgerTotal.units);
  return (
    <Panel title="Balance sheet, now" aside={<a className="link" href={accountUrl(books.id)} target="_blank" rel="noreferrer">on nearblocks</a>} id="balance">
      <p className="text-[14px] muted">Tokens held ({deployment.tokenSymbol})</p>
      <p className="num mt-1 text-[clamp(32px,4vw,44px)] leading-none font-medium tracking-[-0.03em]" data-testid="balance-held">{bal.held.usd}</p>
      {total > 0n ? (
        <div className="mt-4 flex h-3 gap-[3px] overflow-hidden rounded-[6px]" role="img" aria-label={parts.map((p) => `${p.key} ${p.value.usd}`).join(", ")}>
          {parts.filter((p) => BigInt(p.value.units) > 0n).map((p) => <div key={p.key} style={{ flexGrow: Number(BigInt(p.value.units) * 10_000n / total), background: p.color }} />)}
        </div>
      ) : null}
      <dl className="dl mt-4" data-testid="balance-lines">
        {parts.map((p) => (
          <div key={p.key} className="contents">
            <dt className="flex items-center gap-2"><span aria-hidden className="h-[10px] w-[10px] shrink-0 rounded-[3px]" style={{ background: p.color }} />{p.key}<Info label={p.key} tip={p.tip} /></dt>
            <dd>{p.value.usd}</dd>
          </div>
        ))}
        <dt className="border-t border-[var(--line)] pt-2 text-[var(--ink)]">Recorded in the ledger</dt>
        <dd className="border-t border-[var(--line)] pt-2 font-medium">{bal.ledgerTotal.usd}</dd>
      </dl>
      <div className={`mt-4 rounded-[12px] px-4 py-3 text-[15px] ${bal.check === "short" ? "bg-[rgb(255_122_110_/_0.1)]" : "bg-[var(--surface-2)]"}`} data-testid="balance-check">
        <p className="font-medium" style={{ color: bal.check === "short" ? "var(--danger)" : "var(--ok)" }}>
          {bal.check === "equal" ? "Every dollar accounted for ✓" : bal.check === "covers" ? "Balance covers the books ✓" : "Balance below the books"}
        </p>
        <p className="mt-1 text-[14px] text-[var(--ink-2)]">
          {bal.check === "equal"
            ? `The token says it holds ${bal.held.usd}; the ledger accounts for ${bal.ledgerTotal.usd}. The same check npm run verify runs.`
            : bal.check === "covers"
              ? `It holds ${bal.difference.usd} more than the ledger records: plain transfers the contract never booked. The same check npm run verify runs.`
              : `The ledger records ${bal.difference.usd} more than the token says it holds.`}
        </p>
      </div>
      <dl className="dl mt-4">
        <dt>Compute budget (NEAR)<Info label="compute budget" tip="NEAR the business spends on secure computing and storage, separate from its dollars. Anyone can add to it." /></dt>
        <dd data-testid="balance-tank">{bal.tankNear} NEAR</dd>
      </dl>
    </Panel>
  );
}

function CustomersPanel({ books }: { books: Books }) {
  const c = books.customers;
  const kinds: CustomerKind[] = ["outside", "guest", "team", "heartbeat"];
  const counted = kinds.reduce((n, k) => n + c.byKind[k].accounts, 0);
  return (
    <Panel title="Customers" aside={c.complete ? `${c.uniqueLifetime} paying ${c.uniqueLifetime === 1 ? "account" : "accounts"}` : `${c.uniqueLifetime} in all; breakdown of the last ${c.jobsInRecords} jobs`} id="customers">
      {counted === 0 ? (
        <EmptyState title="No customers yet." body="Nobody has bought from this business. Its first sale will show here, with who bought it." action={{ href: `/b/${books.id}`, label: "Buy its first check" }} />
      ) : (
        <>
          <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
            <div>
              <p className="num text-[clamp(28px,3.4vw,36px)] leading-none font-medium tracking-[-0.02em]" data-testid="customers-visitors">{c.visitors} <span className="text-[16px] font-normal tracking-normal muted">outside {c.visitors === 1 ? "visitor" : "visitors"}</span></p>
              <p className="mt-1 text-[15px] text-[var(--ink-2)]" data-testid="customers-team">and {c.team} team {c.team === 1 ? "account" : "accounts"}{c.matchesCounter ? `, ${c.uniqueLifetime} in all, the same as the contract's own count` : ""}</p>
              <div className="mt-4 flex h-3 gap-[3px] overflow-hidden rounded-[6px]" role="img" aria-label={kinds.map((k) => `${KIND_LABEL[k]} ${c.byKind[k].accounts}`).join(", ")}>
                {kinds.filter((k) => c.byKind[k].accounts > 0).map((k) => <div key={k} style={{ flexGrow: c.byKind[k].accounts, background: KIND_TONE[k] }} />)}
              </div>
            </div>
            <table className="table">
              <thead><tr><th scope="col">Who</th><th scope="col" className="r">Accounts</th><th scope="col" className="r">Sales</th><th scope="col" className="r hidden sm:table-cell">Paid</th></tr></thead>
              <tbody>
                {kinds.map((k) => (
                  <tr key={k} data-testid={`kind-${k}`}>
                    <td className="!py-2"><span className="flex items-center gap-2"><span aria-hidden className="h-[10px] w-[10px] shrink-0 rounded-[3px]" style={{ background: KIND_TONE[k] }} />{KIND_LABEL[k]}</span></td>
                    <td className="r !py-2">{c.byKind[k].accounts}</td>
                    <td className="r !py-2">{c.byKind[k].sales}</td>
                    <td className="r hidden !py-2 sm:table-cell">{c.byKind[k].revenue.usd}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <More label="Who counts as team">
            <p>Team means the Lien team&rsquo;s own accounts: the heartbeat buyer {shortAccount("lien-f4-3863.testnet")} (a scheduled job that buys one check every few hours), the role accounts lien-f1 to lien-f7, its lender agent, and lien-13569.testnet with its sub-accounts. Free guest accounts made for visitors, and every other account, count as outside.</p>
          </More>
          <h3 className="mt-5 mb-1 text-[15px] font-medium">Latest sales</h3>
          <div className="w-full overflow-hidden">
            <table className="table w-full table-fixed" data-testid="recent-sales">
              <thead><tr><th scope="col" className="w-[52px]">Job</th><th scope="col">Bought by</th><th scope="col" className="hidden w-[30%] md:table-cell">Checked</th><th scope="col" className="r w-[84px]">Paid</th><th scope="col" className="r hidden w-[150px] sm:table-cell">When (UTC)</th></tr></thead>
              <tbody>
                {c.recent.map((s) => (
                  <tr key={s.job}>
                    <td className="num">#{s.job}</td>
                    <td className="min-w-0">
                      <a className="link block truncate" href={accountUrl(s.payer)} target="_blank" rel="noreferrer" title={s.payer}>{shortAccount(s.payer, 26)}</a>
                      <span className="mt-1 inline-flex items-center gap-2 text-[12px] text-[var(--ink-2)]"><span aria-hidden className="h-[8px] w-[8px] rounded-[2px]" style={{ background: KIND_TONE[s.kind] }} />{s.label}</span>
                    </td>
                    <td className="hidden truncate md:table-cell" title={s.input}>{s.input || "(empty)"}</td>
                    <td className="r whitespace-nowrap">{s.status === "Refunded" ? <span className="muted" title="Refunded in full">{s.paid.usd}<span className="block text-[12px]">refunded</span></span> : s.paid.usd}</td>
                    <td className="r hidden whitespace-nowrap sm:table-cell">{dateTime(s.at).replace(" UTC", "")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Panel>
  );
}

const LOAN_WORD: Record<string, string> = { Funding: "Raising", Active: "Open", Repaid: "Paid in full", Foreclosed: "Taken over, for sale", Sold: "Taken over and sold", Cancelled: "Cancelled" };

function LoansPanel({ books }: { books: Books }) {
  const l = books.loans;
  return (
    <Panel title="Loans" aside={`${l.count} ${l.count === 1 ? "loan" : "loans"}`} id="loans">
      {l.count === 0 ? (
        <EmptyState title="It has never borrowed." body="With no loan, every sale stays with the business. Its first loan will show here with what lenders got back." />
      ) : (
        <>
          <dl className="dl" data-testid="loan-totals">
            <dt>Borrowed</dt><dd>{l.borrowed.usd}</dd>
            <dt>Paid to lenders</dt><dd>{l.repaidToLenders.usd}</dd>
            <dt>Still owed</dt><dd data-testid="loans-outstanding">{l.outstanding.usd}</dd>
            <dt>Paid in full · taken over · sold</dt><dd>{l.repaidInFull} · {l.foreclosed} · {l.sold}</dd>
          </dl>
          <div className="mt-4 w-full overflow-hidden">
            <table className="table w-full table-fixed">
              <thead><tr><th scope="col" className="w-[48px]">Loan</th><th scope="col">Outcome</th><th scope="col" className="r w-[132px]">Lenders got</th><th scope="col" className="r hidden w-[88px] sm:table-cell">Still owed</th></tr></thead>
              <tbody>
                {l.lines.map((loan) => (
                  <tr key={loan.id}>
                    <td>{loan.id + 1}</td>
                    <td className="min-w-0"><span className="block truncate">{LOAN_WORD[loan.status]}</span><span className="text-[12px] muted">{loan.principal.usd} from {loan.holders} {loan.holders === 1 ? "lender" : "lenders"}</span></td>
                    <td className="r">{loan.status === "Funding" || loan.status === "Cancelled" ? <span className="muted">-</span> : <>{loan.repaid.usd}<span className="block text-[12px] muted">of {loan.totalDue.usd}</span></>}</td>
                    <td className="r hidden sm:table-cell">{loan.status === "Active" || loan.status === "Foreclosed" ? loan.outstanding.usd : <span className="muted">-</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Panel>
  );
}

function PolicyPanel({ books }: { books: Books }) {
  const p = books.policy;
  const open = p.loanOpen;
  const rules: Array<[string, string]> = [
    ["The program, price and spending rules", open ? "Locked during the loan. They change only if lenders holding more than half of it approve, and a vote can only tighten spending: no new vendors, no higher caps." : "The owner can change them while there is no loan."],
    ["The split of each sale", open ? "Fixed in the loan's terms. Nobody can change it until the loan closes." : "Set by the owner in the next loan's terms; lenders accept it by lending."],
    ["Running money", open ? "Only the business's own code spends it, on approved vendors within the caps. The owner can only move it to lenders." : "The owner can withdraw it."],
    ["Owner's share", "The owner can withdraw it, except while the business is behind on payments or taken over: then it goes to lenders."],
    ["Compute budget", open ? "Anyone can add NEAR. Nobody can take it out during the loan." : "Anyone can add NEAR; the owner can take it out."],
    ["Who owns it", open ? "It cannot be handed over during the loan. If payments stop past the extra time, anyone can take it over for the lenders." : "The owner can hand it to another account."],
  ];
  return (
    <Panel title="The rules, set by people" aside={open ? "Frozen by the open loan" : "No loan open"} id="policy">
      <p className="text-[15px] text-[var(--ink-2)]">Set before anyone lent. The contract refuses anything outside them.<Info label="the rules" tip="People set these limits before anyone lent. The business runs itself inside them, and the contract refuses anything outside them." /></p>
      <dl className="dl mt-4" data-testid="policy">
        <dt>Price of one check</dt><dd>{p.price.usd}</dd>
        <dt>Approved vendors</dt><dd>{p.vendors.length ? p.vendors.map((v) => <span key={v} className="block"><AccountLink id={v} max={24} /></span>) : <span className="muted">None: it cannot pay anyone</span>}</dd>
        <dt>Most per payment</dt><dd>{p.maxPerTx.usd}</dd>
        <dt>Most per day</dt><dd>{p.maxPerDay.usd}</dd>
        <dt>Spent today (UTC)</dt><dd>{p.spentToday.usd}</dd>
        <dt>Payments refused by the policy</dt><dd>{p.blocked}</dd>
        <dt>Each sale goes</dt>
        <dd data-testid="policy-split">{p.split ? `${percent(p.split.lenderBps)} lenders, ${percent(p.split.operatorBps)} owner, ${percent(p.split.keptBps)} kept` : "All kept: no loan"}</dd>
        <dt>Pinned program</dt><dd><code className="text-[13px]" title={p.wasmHash}>{p.wasmHash.slice(0, 12)}…</code></dd>
      </dl>
      <h3 className="mt-5 mb-2 text-[15px] font-medium">Who can change what</h3>
      <ul className="divide-y divide-[var(--line)] text-[14px]">
        {rules.map(([what, who]) => (
          <li key={what} className="py-2"><p className="font-medium">{what}</p><p className="text-[var(--ink-2)]">{who}</p></li>
        ))}
      </ul>
    </Panel>
  );
}

function HowPanel({ books }: { books: Books }) {
  const rpc = RPC_URLS[NETWORK][0]!;
  const at = books.block ? `"block_id":${books.block.height}` : `"finality":"final"`;
  const curl = `curl -s ${rpc} -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"query","params":{"request_type":"call_function",${at},"account_id":"${books.id}","method_name":"get_agent","args_base64":"e30="}}' | jq '.result.result | implode | fromjson | {ledger, stats}'`;
  return (
    <Panel title="Check it yourself" id="how">
      <p className="text-[15px] text-[var(--ink-2)]">Every figure here comes from four view calls at one block.</p>
      <More label="How these numbers are computed" testId="books-how">
        <p>Sales, vendor payments and customers come from the contract&rsquo;s own counters (<code>get_agent</code>), refunds and the 7-day figures from its job records (<code>get_jobs</code>), lenders&rsquo; figures from its loans (<code>get_loans</code>), and tokens held from the token (<code>ft_balance_of</code>), all read at the same block and rounded to the cent the way the rest of the app rounds.</p>
      </More>
      <div className="mt-4 flex flex-wrap gap-2">
        <a className="btn btn-secondary btn-sm" href={`/api/books/${books.id}`} target="_blank" rel="noreferrer" data-testid="books-json">These books as JSON</a>
        <a className="btn btn-ghost btn-sm" href={accountUrl(books.id)} target="_blank" rel="noreferrer">The business on nearblocks</a>
        <Link className="btn btn-ghost btn-sm" href={`/b/${books.id}`}>Back to {books.name}</Link>
      </div>
      <p className="mt-4 mb-2 text-[14px] muted">The raw view call, at the same block:</p>
      <CodeBlock>{curl}</CodeBlock>
    </Panel>
  );
}
