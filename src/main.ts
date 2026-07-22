import { $ } from "bun";
import { loadConfig } from "./config";
import {
  composeLabel,
  parsePrNumber,
  refreshingLabel,
  repoFromPrUrl,
  resolvePaneCwd,
  rollupChecks,
  type Check,
  type PullRequestState,
} from "./label";
import { parseSubmodulePaths } from "./submodules";
import { lastCheckMs, recordCheck, THROTTLE_WINDOW_MS, throttleElapsed } from "./throttle";

const SOURCE = "gh-pr";

interface PaneCurrent {
  result?: {
    pane?: {
      pane_id?: string;
      cwd?: string;
      foreground_cwd?: string;
      tokens?: Record<string, string>;
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
  url: string;
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
  const cwd = pane ? resolvePaneCwd(pane) : undefined;
  if (!paneId || !cwd) return null;
  return { paneId, cwd, currentStatus: pane?.tokens?.pr };
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
  const out = await $`gh pr view ${branch} --json number,state,url`.cwd(cwd).nothrow().quiet();
  if (out.exitCode !== 0) return null;
  try {
    const data = JSON.parse(out.stdout.toString()) as {
      number: number;
      state?: string;
      url?: string;
    };
    if (typeof data.number !== "number" || typeof data.url !== "string") return null;
    const state = data.state === "CLOSED" || data.state === "MERGED" ? data.state : "OPEN";
    return { number: data.number, state, url: data.url };
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

// Candidate git work trees to inspect for a PR, in priority order: the pane's
// own repo first, then each initialized submodule. Workspaces that vendor
// their code as git submodules keep the PR branch inside the submodule while
// the superproject sits on a plain branch with no PR, so the PR would
// otherwise never be found. A repo without submodules yields just the pane
// dir, adding no cost to the common case.
async function candidateDirs(cwd: string): Promise<string[]> {
  const dirs = [cwd];
  const top = await $`git -C ${cwd} rev-parse --show-toplevel`.nothrow().quiet();
  if (top.exitCode !== 0) return dirs;
  const root = top.stdout.toString().trim();
  const status = await $`git -C ${root} submodule status --recursive`.nothrow().quiet();
  if (status.exitCode !== 0) return dirs;
  dirs.push(...parseSubmodulePaths(status.stdout.toString(), root));
  return dirs;
}

// First candidate work tree whose current branch has a PR, or null if none do.
// isSubmodule is true when the match came from a submodule rather than the
// pane's own repo (the first candidate).
async function locatePr(
  cwd: string,
): Promise<{ dir: string; branch: string; pr: PullRequest; isSubmodule: boolean } | null> {
  const dirs = await candidateDirs(cwd);
  for (let i = 0; i < dirs.length; i++) {
    const dir = dirs[i];
    const branch = await currentBranch(dir);
    if (!branch) continue;
    const pr = await prInfo(dir, branch);
    if (pr) return { dir, branch, pr, isSubmodule: i > 0 };
  }
  return null;
}

// The repo-name prefix to show on the label for this PR, or undefined when the
// config says not to. Derived from the PR url, so it costs no extra gh call.
function repoLabelFor(
  pr: PullRequest,
  isSubmodule: boolean,
  config: Awaited<ReturnType<typeof loadConfig>>,
): string | undefined {
  const { mode, format } = config.repoName;
  const show = mode === "always" || (mode === "submodule" && isSubmodule);
  if (!show) return undefined;
  const repo = repoFromPrUrl(pr.url);
  if (!repo) return undefined;
  return format === "full" ? `${repo.owner}/${repo.name}` : repo.name;
}

async function setLabel(paneId: string, text: string): Promise<void> {
  await $`herdr pane report-metadata ${paneId} --source ${SOURCE} --token pr=${text}`.nothrow().quiet();
}

async function clearLabel(paneId: string): Promise<void> {
  await $`herdr pane report-metadata ${paneId} --source ${SOURCE} --clear-token pr`.nothrow().quiet();
}

export async function run(targetPaneId?: string, force = false): Promise<void> {
  const pane = await resolvePane(targetPaneId);
  if (!pane) return;

  // Throttle the automatic (focus/worktree) path to one gh check per pane per
  // window. Manual refreshes pass force=true and always run.
  const now = Date.now();
  if (!force && !throttleElapsed(lastCheckMs(pane.paneId), now, THROTTLE_WINDOW_MS)) return;
  recordCheck(pane.paneId, now);

  // If the pane already shows a PR number, swap its icon for the refreshing
  // glyph while the (slower) gh queries run, so the update is visible.
  const previous = parsePrNumber(pane.currentStatus);
  if (previous !== null) {
    await setLabel(pane.paneId, refreshingLabel(previous));
  }

  const located = await locatePr(pane.cwd);
  if (located === null) {
    // No branch here (or in a submodule) has a PR — show nothing rather than a
    // stale label. Also covers leaving a repo or a detached HEAD.
    await clearLabel(pane.paneId);
    return;
  }
  const { dir, branch, pr, isSubmodule } = located;
  const repoLabel = repoLabelFor(pr, isSubmodule, await loadConfig());

  if (pr.state !== "OPEN") {
    await setLabel(pane.paneId, composeLabel(pr.number, "none", pr.state, repoLabel));
    return;
  }

  const checks = await prChecks(dir, branch);
  const label = composeLabel(pr.number, rollupChecks(checks), "OPEN", repoLabel);
  await setLabel(pane.paneId, label);
}

// Open the PR for a pane's branch in the browser. With no argument it uses the
// focused pane; pass a pane id to target a specific pane. Does nothing if the
// pane is not in a repo or neither the repo nor a submodule has a PR.
export async function openPr(targetPaneId?: string): Promise<void> {
  const pane = await resolvePane(targetPaneId);
  if (!pane) return;

  const located = await locatePr(pane.cwd);
  if (!located) return;
  const { dir, branch, pr } = located;

  const opened = await $`gh pr view ${branch} --web`.cwd(dir).nothrow().quiet();
  if (opened.exitCode === 0) return;

  // `gh pr view --web` shells out to xdg-open/open, which has no way to
  // launch a browser over a plain SSH session (no DISPLAY, no text browser
  // installed). That failure is otherwise silent from the pane's point of
  // view, so fall back to surfacing the PR URL directly: a toast (if the
  // user has ui.toast.delivery configured) and the plugin log.
  await $`herdr notification show ${"PR ready"} --body ${pr.url}`.nothrow().quiet();
  console.error(`[gh-pr] could not open a browser, PR URL: ${pr.url}`);
}
