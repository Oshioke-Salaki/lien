// Moves a lender's loan share (a "note") to another account and back, on chain, to show that loan
// shares are transferable and so can be sold or given away. A stranger's attempt to move a note it
// does not hold is refused. The note ends where it started; every step is a real transaction.
//
//   LIEN_NETWORK=testnet BUSINESS=watchtower-late-5337.v1.lien-13569.testnet HOLDER=lien-f4-3863.testnet \
//     BUYER=lien-f5-3869.testnet STRANGER=lien-f6-3876.testnet npm run note-transfer

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { account, call, explorerTx, network, refused, ROOT, view } from "./lib.js";

const net = network();
const business = process.env.BUSINESS ?? "watchtower-late-5337.v1.lien-13569.testnet";
const holderId = process.env.HOLDER ?? "lien-f4-3863.testnet";
const buyerId = process.env.BUYER ?? "lien-f5-3869.testnet";
const strangerId = process.env.STRANGER ?? "lien-f6-3876.testnet";

const agent = await view<any>(business, "get_agent", {}, net);
const loan = agent.current_loan;
if (!loan) throw new Error(`${business} has no current loan`);
const loanId: number = loan.id;
const note = (who: string) => view<any>(business, "get_note", { loan_id: loanId, account_id: who }, net);
const holders = async () => (await view<any>(business, "get_loan", { loan_id: loanId }, net)).holders as number;

const before = { holder: await note(holderId), buyer: await note(buyerId), holders: await holders() };
if (!before.holder) throw new Error(`${holderId} holds no note on ${business} loan ${loanId}`);
if (before.buyer) throw new Error(`${buyerId} already holds a note; pick an account without one so the round trip restores the state exactly`);

const steps: object[] = [];
const link = (tx: string) => explorerTx(tx, net);

const reason = await refused(account(strangerId, net), business, "transfer_note", { loan_id: loanId, to: strangerId === buyerId ? holderId : buyerId }, { deposit: 1n, tgas: 30n });
steps.push({ what: "A stranger tries to move a note it does not hold", by: strangerId, refused: true, reason: reason.match(/Smart contract panicked: ([^"\\]+)/)?.[1] ?? reason.slice(0, 200) });
console.log(`REFUSED  stranger: ${JSON.stringify(steps.at(-1))}`);

const out1 = await call(account(holderId, net), business, "transfer_note", { loan_id: loanId, to: buyerId }, { deposit: 1n, tgas: 30n });
const mid = { holder: await note(holderId), buyer: await note(buyerId), holders: await holders() };
steps.push({ what: `The lender moves its whole note to ${buyerId}`, by: holderId, method: "transfer_note", tx: out1.tx, link: link(out1.tx), after: mid });
console.log(`MOVED    ${holderId} -> ${buyerId}  ${link(out1.tx)}`);

const out2 = await call(account(buyerId, net), business, "transfer_note", { loan_id: loanId, to: holderId }, { deposit: 1n, tgas: 30n });
const after = { holder: await note(holderId), buyer: await note(buyerId), holders: await holders() };
steps.push({ what: `${buyerId} moves it back`, by: buyerId, method: "transfer_note", tx: out2.tx, link: link(out2.tx), after });
console.log(`MOVED    ${buyerId} -> ${holderId}  ${link(out2.tx)}`);

const ok =
  !mid.holder && mid.buyer?.principal === before.holder.principal && mid.buyer?.claimable === before.holder.claimable && mid.holders === before.holders &&
  after.holder?.principal === before.holder.principal && !after.buyer && after.holders === before.holders;

const record = { business, network: net, loan: loanId, loanStatus: loan.status, at: new Date().toISOString(), before, steps, restored: ok };
writeFileSync(join(ROOT, `docs/evidence/note-transfer-${net}.json`), JSON.stringify(record, null, 2) + "\n");
console.log(ok ? `\nThe note moved with its principal and unclaimed repayments, and came back. Saved docs/evidence/note-transfer-${net}.json` : "\n!! state did not round-trip; see the evidence file");
if (!ok) process.exit(1);
