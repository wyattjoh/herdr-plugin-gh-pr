export type CheckBucket = "pass" | "fail" | "pending" | "skipping" | "cancel";

export interface Check {
  bucket: CheckBucket;
}

export type CiRollup = "pass" | "fail" | "pending" | "none";

/**
 * GitHub pull request lifecycle state used for sidebar label composition.
 */
export type PullRequestState = "OPEN" | "CLOSED" | "MERGED";

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

const TERMINAL_PR_SYMBOL: Record<Exclude<PullRequestState, "OPEN">, string> = {
  MERGED: "◆",
  CLOSED: "⊘",
};

// Glyph shown in place of the CI symbol while the status is being recomputed.
export const REFRESHING = "⟳";

// Pick the working directory to use for a pane. Prefer cwd (the shell's
// working directory, e.g. the project root the user launched from) over
// foreground_cwd (the running foreground process's directory, which for an
// agent like Claude Code can be a transient sandbox path such as /tmp).
export function resolvePaneCwd(pane: {
  cwd?: string;
  foreground_cwd?: string;
}): string | undefined {
  return pane.cwd ?? pane.foreground_cwd;
}

// Extract the PR number from an existing label like "#123 ✓", "#123 ⟳", or a
// repo-prefixed "workspace #123 ✓". Used to keep the number on screen while a
// refresh is in flight.
export function parsePrNumber(label: string | null | undefined): number | null {
  const match = label?.match(/#(\d+)\b/);
  return match ? Number(match[1]) : null;
}

// Extract "owner/name" from a GitHub PR URL, or null if it doesn't match. Used
// to derive the repo-name prefix without an extra gh call (the PR url is
// already known).
export function repoFromPrUrl(url: string): { owner: string; name: string } | null {
  const match = url.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/\d+/);
  return match ? { owner: match[1], name: match[2] } : null;
}

// Label shown during a refresh: keep the number, swap the CI symbol for the
// refreshing glyph.
export function refreshingLabel(prNumber: number): string {
  return `#${prNumber} ${REFRESHING}`;
}

/**
 * Compose the concise PR sidebar label from a PR number, CI rollup, and PR
 * state. An optional repo label is prefixed (e.g. "workspace #123 ✓") to show
 * which repository the PR belongs to.
 */
export function composeLabel(
  prNumber: number,
  ci: CiRollup,
  prState: PullRequestState = "OPEN",
  repoLabel?: string,
): string {
  const prefix = repoLabel ? `${repoLabel} ` : "";

  if (prState !== "OPEN") {
    return `${prefix}#${prNumber} ${TERMINAL_PR_SYMBOL[prState]}`;
  }

  const symbol = CI_SYMBOL[ci];
  return symbol ? `${prefix}#${prNumber} ${symbol}` : `${prefix}#${prNumber}`;
}
