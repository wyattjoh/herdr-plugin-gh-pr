import { $ } from "bun";
import {
  composeLabel,
  parsePrNumber,
  refreshingLabel,
  rollupChecks,
  type Check,
  type PullRequestState,
} from "./label";
import { lastCheckMs, recordCheck, THROTTLE_WINDOW_MS, throttleElapsed } from "./throttle";

const SOURCE = "gh-pr";

interface PaneCurrent {
  result?: {
    pane?: {
      pane_id?: string;
      cwd?: string;
      foreground_cwd?: string;
      custom_status?: string;
    };
  };
}

interface Pane {
  paneId: string;
  cwd: string;
  currentStatus?: string;
}

interface PullRequest {
  number: number;
  state: PullRequestState;
}

// Resolve a pane id, working directory, and current label from herdr. With no
// argument it uses the focused pane (the manifest's per-event behavior); pass a
// pane id to target a specific pane (used by the seed loop and a targeted
// refresh).
async function resolvePane(targetPaneId?: string): Promise<Pane | null> {
  const out = targetPaneId
    ? await $`herdr pane get ${targetPaneId}`.nothrow().quiet()
    : await $`herdr pane current`.nothrow().quiet();
  if (out.exitCode !== 0) return null;
  let parsed: PaneCurrent;
  try {
    parsed = JSON.parse(out.stdout.toString());
  } catch {
    return null;
  }
  const pane = parsed.result?.pane;
  const paneId = pane?.pane_id;
  const cwd = pane?.foreground_cwd ?? pane?.cwd;
  if (!paneId || !cwd) return null;
  return { paneId, cwd, currentStatus: pane?.custom_status };
}

// Current branch name, or null if the dir is not a git work tree or is detached.
async function currentBranch(cwd: string): Promise<string | null> {
  const inside = await $`git -C ${cwd} rev-parse --is-inside-work-tree`.nothrow().quiet();
  if (inside.exitCode !== 0 || inside.stdout.toString().trim() !== "true") return null;
  const branch = await $`git -C ${cwd} rev-parse --abbrev-ref HEAD`.nothrow().quiet();
  if (branch.exitCode !== 0) return null;
  const name = branch.stdout.toString().trim();
  if (!name || name === "HEAD") return null;
  return name;
}

// PR identity for the branch, or null when the branch has no PR.
async function prInfo(cwd: string, branch: string): Promise<PullRequest | null> {
  const out = await $`gh pr view ${branch} --json number,state`.cwd(cwd).nothrow().quiet();
  if (out.exitCode !== 0) return null;
  try {
    const data = JSON.parse(out.stdout.toString()) as { number: number; state?: string };
    if (typeof data.number !== "number") return null;
    const state = data.state === "CLOSED" || data.state === "MERGED" ? data.state : "OPEN";
    return { number: data.number, state };
  } catch {
    return null;
  }
}

// CI checks for the branch. gh pr checks exits non-zero when checks are
// failing or pending, so ignore the exit code and parse the JSON regardless.
async function prChecks(cwd: string, branch: string): Promise<Check[]> {
  const out = await $`gh pr checks ${branch} --json bucket`.cwd(cwd).nothrow().quiet();
  try {
    const data = JSON.parse(out.stdout.toString()) as Check[];
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

async function setLabel(paneId: string, text: string): Promise<void> {
  await $`herdr pane report-metadata ${paneId} --source ${SOURCE} --custom-status ${text}`.nothrow().quiet();
}

async function clearLabel(paneId: string): Promise<void> {
  await $`herdr pane report-metadata ${paneId} --source ${SOURCE} --clear-custom-status`.nothrow().quiet();
}

export async function run(targetPaneId?: string, force = false): Promise<void> {
  const pane = await resolvePane(targetPaneId);
  if (!pane) return;

  // Throttle the automatic (focus/worktree) path to one gh check per pane per
  // window. Manual refreshes pass force=true and always run.
  const now = Date.now();
  if (!force && !throttleElapsed(lastCheckMs(pane.paneId), now, THROTTLE_WINDOW_MS)) return;
  recordCheck(pane.paneId, now);

  const branch = await currentBranch(pane.cwd);
  if (!branch) {
    // Left a repo (or detached HEAD), drop any stale label on this pane.
    await clearLabel(pane.paneId);
    return;
  }

  // If the pane already shows a PR number, swap its icon for the refreshing
  // glyph while the (slower) gh queries run, so the update is visible.
  const previous = parsePrNumber(pane.currentStatus);
  if (previous !== null) {
    await setLabel(pane.paneId, refreshingLabel(previous));
  }

  const pr = await prInfo(pane.cwd, branch);
  if (pr === null) {
    // Branch has no PR, show nothing rather than a stale label.
    await clearLabel(pane.paneId);
    return;
  }

  if (pr.state !== "OPEN") {
    await setLabel(pane.paneId, composeLabel(pr.number, "none", pr.state));
    return;
  }

  const checks = await prChecks(pane.cwd, branch);
  const label = composeLabel(pr.number, rollupChecks(checks));
  await setLabel(pane.paneId, label);
}

// Open the PR for a pane's branch in the browser. With no argument it uses the
// focused pane; pass a pane id to target a specific pane. Does nothing if the
// pane is not in a repo or the branch has no PR.
export async function openPr(targetPaneId?: string): Promise<void> {
  const pane = await resolvePane(targetPaneId);
  if (!pane) return;

  const branch = await currentBranch(pane.cwd);
  if (!branch) return;

  await $`gh pr view ${branch} --web`.cwd(pane.cwd).nothrow().quiet();
}
