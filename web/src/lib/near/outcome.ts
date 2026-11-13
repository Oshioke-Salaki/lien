// Turns a raw transaction outcome into what actually happened for the user.
//
// A token transfer "succeeds" even when the receiving contract refused it: the
// token quietly refunds and reports success. So success has to be read from the
// receipts, not the top-level status.

export type RawOutcome = {
  status?: unknown;
  transaction?: { hash?: string };
  transaction_outcome?: { id?: string };
  receipts_outcome?: Array<{ outcome: { status: unknown; logs?: string[]; executor_id?: string } }>;
};

export type TxResult = {
  hash: string;
  ok: boolean;
  /** Plain words for the first failure, if any. */
  error?: string;
  logs: string[];
  events: Array<{ event: string; data: Record<string, unknown> }>;
  /** Accounts whose receipts failed. */
  failedOn: string[];
};

const failureText = (status: unknown): string | null => {
  const failure = (status as { Failure?: unknown } | null)?.Failure;
  if (!failure) return null;
  const text = JSON.stringify(failure);
  const panic = /Smart contract panicked: ([^"\\]+)/.exec(text)?.[1];
  if (panic) return panic.trim();
  const named = /"([A-Za-z]+Error|[A-Za-z]*NotEnough[A-Za-z]*|LackBalanceForState|AccountAlreadyExists|AccountDoesNotExist)"/.exec(text)?.[1];
  return named ?? "The transaction failed";
};

/** Said when the account cannot pay the network fee; the faucet link lives with the notice. */
export const FEE_SHORTFALL = "Your account needs a little NEAR to pay the network fee for this. NEAR is the network's own currency; a fee costs a fraction of a cent.";

/** Contract messages rewritten for someone who has never seen the code. */
const FRIENDLY: Array<[RegExp, string]> = [
  [/is not registered/, "That account has no dollar balance yet. Add test funds first."],
  [/The account doesn't have enough balance/, "You do not have enough money for this."],
  [/LackBalanceForState|NotEnoughBalance|Not enough balance/i, FEE_SHORTFALL],
  [/AccountAlreadyExists/, "That name is taken. Try another."],
];

/** True when an action failed only because the account had too little NEAR for network fees. */
export const isFeeShortfall = (message: string | undefined) =>
  !!message && (/LackBalanceForState|NotEnoughBalance|Not enough balance/i.test(message) || message === FEE_SHORTFALL);

export function friendlyError(message: string): string {
  const match = FRIENDLY.find(([pattern]) => pattern.test(message));
  if (match) return match[1];
  return message.charAt(0).toUpperCase() + message.slice(1).replace(/\.?$/, ".");
}

export function readOutcome(raw: RawOutcome, requiredOn?: string): TxResult {
  const receipts = raw.receipts_outcome ?? [];
  const logs = receipts.flatMap((r) => r.outcome.logs ?? []);
  const failed = receipts
    .map((r) => ({ on: r.outcome.executor_id ?? "", error: failureText(r.outcome.status) }))
    .filter((r): r is { on: string; error: string } => r.error !== null);
  const top = failureText(raw.status);
  // A failed payout to a vendor is survivable. A failure on the contract the user
  // was talking to, or at the top level, means their request did not go through.
  const blocking = top ?? failed.find((f) => !requiredOn || f.on === requiredOn)?.error ?? null;

  const events: TxResult["events"] = [];
  for (const line of logs) {
    if (!line.startsWith("EVENT_JSON:")) continue;
    try {
      const parsed = JSON.parse(line.slice("EVENT_JSON:".length));
      if (parsed.standard === "lien") events.push({ event: parsed.event, data: parsed.data });
    } catch {
      // Not ours to interpret.
    }
  }

  return {
    hash: raw.transaction?.hash ?? raw.transaction_outcome?.id ?? "",
    ok: !blocking,
    error: blocking ? friendlyError(blocking) : undefined,
    logs,
    events,
    failedOn: failed.map((f) => f.on),
  };
}
