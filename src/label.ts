export type PrState = "OPEN" | "CLOSED" | "MERGED";

export interface PrInfo {
  number: number;
  state: PrState;
  isDraft: boolean;
}

export type CheckBucket = "pass" | "fail" | "pending" | "skipping" | "cancel";

export interface Check {
  bucket: CheckBucket;
}

export type CiRollup = "pass" | "fail" | "pending" | "none";

// Collapse per-check buckets into one rollup, worst-status-wins.
// gh's buckets are: pass, fail, pending, skipping, cancel.
export function rollupChecks(checks: Check[]): CiRollup {
  if (checks.length === 0) return "none";
  const buckets = new Set(checks.map((c) => c.bucket));
  if (buckets.has("fail") || buckets.has("cancel")) return "fail";
  if (buckets.has("pending")) return "pending";
  return "pass";
}

const CI_SYMBOL: Record<CiRollup, string> = {
  pass: "✓",
  fail: "✗",
  pending: "●",
  none: "",
};

// "PR #123 open ✓". CI symbol is omitted when there are no checks, and for
// merged/closed PRs where CI status is no longer meaningful.
export function composeLabel(pr: PrInfo, ci: CiRollup): string {
  let stateWord: string;
  if (pr.state === "MERGED") stateWord = "merged";
  else if (pr.state === "CLOSED") stateWord = "closed";
  else if (pr.isDraft) stateWord = "draft";
  else stateWord = "open";

  const base = `PR #${pr.number} ${stateWord}`;
  const terminal = pr.state === "MERGED" || pr.state === "CLOSED";
  const symbol = terminal ? "" : CI_SYMBOL[ci];
  return symbol ? `${base} ${symbol}` : base;
}
