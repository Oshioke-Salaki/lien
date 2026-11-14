// The rules lendvault v2 (contracts/lendvault2) enforces on a Sentinel check before it
// lends, mirrored here so the agent can skip a lend the vault would refuse. The vault
// is the authority: this copy only saves a refused transaction, it protects nothing.

export type SentinelJob = {
  id: number;
  payer: string;
  input: string;
  status: string;
  report: string | null;
  created_at: number;
  wasm_hash: string;
};

export type Vault2Policy = {
  sentinel: string;
  max_check_age_secs: number;
  allow_warn: boolean;
  max_check_price: string;
  max_check_spend: string;
};

export type CheckFacts = {
  /** The v2 vault's account: the only payer it accepts. */
  vault: string;
  /** The business's operator, from its get_agent. */
  operator: string;
  /** Sentinel's pinned build, from its get_agent service.wasm.hash. */
  pinnedHash: string;
  /** Now, in seconds of block time. */
  now: number;
};

/** The exact input the vault sends and expects. */
export const checkInput = (target: string) => `check ${target}`;

/**
 * Why the vault would refuse to lend on this job, in the order it checks, or null if
 * it would accept the check. The loan caps are checked separately.
 */
export function checkRefusal(job: SentinelJob | null, policy: Vault2Policy, facts: CheckFacts): string | null {
  if (!job) return "Sentinel has no such job";
  if (job.status !== "Done") return `check ${job.id} is not Done (status ${job.status})`;
  if (job.payer !== facts.vault) return `check ${job.id} was paid by ${job.payer}, not by this vault`;
  if (job.wasm_hash !== facts.pinnedHash) return `check ${job.id} ran build ${job.wasm_hash}, not Sentinel's pinned build ${facts.pinnedHash}`;
  const age = Math.max(0, facts.now - job.created_at);
  if (age > policy.max_check_age_secs) return `check ${job.id} is ${age} seconds old, above max_check_age_secs ${policy.max_check_age_secs}`;
  let report: { target?: string; level?: string };
  try {
    report = job.report ? (JSON.parse(job.report) as typeof report) : {};
  } catch {
    report = {};
  }
  if (!report.level || report.target === undefined) return `check ${job.id} has no readable report`;
  if (report.level === "high") return `check ${job.id} on ${report.target} is high risk (BLOCK)`;
  if (report.level === "medium" && !policy.allow_warn) return `check ${job.id} on ${report.target} is medium risk (WARN), and this vault lends only on low`;
  if (report.level !== "low" && report.level !== "medium") return `check ${job.id} has an unknown level ${report.level}`;
  if (job.input !== checkInput(facts.operator) || report.target !== facts.operator) {
    return `check ${job.id} is on ${report.target}, not on the business's operator ${facts.operator}`;
  }
  return null;
}

/** The "refused: ..." message out of NEAR's nested failure object, or the whole failure. */
export function refusalMessage(failure: unknown): string {
  const text = JSON.stringify(failure) ?? "";
  return /refused: [^"\\]*/.exec(text)?.[0] ?? text;
}

/** A recent, passing check this vault already bought on the operator, newest first, if any. */
export function reusableCheck(jobs: SentinelJob[], policy: Vault2Policy, facts: CheckFacts): SentinelJob | null {
  return [...jobs].sort((a, b) => b.id - a.id).find((j) => checkRefusal(j, policy, facts) === null) ?? null;
}
