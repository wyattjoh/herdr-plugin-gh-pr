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

// Glyph shown in place of the CI symbol while the status is being recomputed.
export const REFRESHING = "⟳";

// Extract the PR number from an existing label like "#123 ✓" or "#123 ⟳".
// Used to keep the number on screen while a refresh is in flight.
export function parsePrNumber(label: string | null | undefined): number | null {
  const match = label?.match(/^#(\d+)\b/);
  return match ? Number(match[1]) : null;
}

// Label shown during a refresh: keep the number, swap the CI symbol for the
// refreshing glyph.
export function refreshingLabel(prNumber: number): string {
  return `#${prNumber} ${REFRESHING}`;
}

// "#123 ✓". Just the PR number and a CI rollup symbol, kept short for the
// sidebar. The CI symbol is omitted when there are no checks.
export function composeLabel(prNumber: number, ci: CiRollup): string {
  const symbol = CI_SYMBOL[ci];
  return symbol ? `#${prNumber} ${symbol}` : `#${prNumber}`;
}
