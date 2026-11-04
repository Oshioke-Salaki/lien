import { describe, expect, it } from "vitest";
import { friendlyError, readOutcome } from "./outcome";

const panic = (msg: string) => ({ Failure: { ActionError: { kind: { FunctionCallError: { ExecutionError: `Smart contract panicked: ${msg}` } } } } });
const ok = { SuccessValue: "" };

describe("readOutcome", () => {
  it("reports plain success", () => {
    const r = readOutcome({ status: ok, transaction: { hash: "abc" }, receipts_outcome: [{ outcome: { status: ok, executor_id: "a" } }] });
    expect(r).toMatchObject({ hash: "abc", ok: true });
  });

  it("catches a payment the contract refused even though the transaction succeeded", () => {
    const r = readOutcome(
      {
        status: { SuccessValue: "IjAi" },
        transaction: { hash: "abc" },
        receipts_outcome: [
          { outcome: { status: ok, executor_id: "token" } },
          { outcome: { status: panic("payment is below the price of a job"), executor_id: "agent" } },
          { outcome: { status: ok, executor_id: "token" } },
        ],
      },
      "agent",
    );
    expect(r.ok).toBe(false);
    expect(r.error).toBe("Payment is below the price of a job.");
  });

  it("does not fail the user for a vendor payout that bounced", () => {
    const r = readOutcome(
      { status: ok, receipts_outcome: [{ outcome: { status: panic("The account v.near is not registered"), executor_id: "token" } }] },
      "agent",
    );
    expect(r.ok).toBe(true);
    expect(r.failedOn).toEqual(["token"]);
  });

  it("treats a top-level failure as final", () => {
    const r = readOutcome({ status: panic("only the operator can do this") });
    expect(r.ok).toBe(false);
    expect(r.error).toBe("Only the operator can do this.");
  });

  it("reads Lien events and ignores others", () => {
    const r = readOutcome({
      status: ok,
      receipts_outcome: [
        {
          outcome: {
            status: ok,
            logs: [
              'EVENT_JSON:{"standard":"lien","version":"1.0.0","event":"job_started","data":{"job_id":3}}',
              'EVENT_JSON:{"standard":"nep141","event":"ft_transfer","data":[]}',
              "EVENT_JSON:{broken",
              "plain log",
            ],
          },
        },
      ],
    });
    expect(r.events).toEqual([{ event: "job_started", data: { job_id: 3 } }]);
  });
});

describe("friendlyError", () => {
  it("explains token registration", () => {
    expect(friendlyError("The account a.near is not registered")).toMatch(/no token balance/);
  });
  it("capitalises and ends contract messages", () => {
    expect(friendlyError("the auction has no bids")).toBe("The auction has no bids.");
  });
});
