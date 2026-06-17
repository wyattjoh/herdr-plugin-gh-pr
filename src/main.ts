import { $ } from "bun";
import {
  composeLabel,
  rollupChecks,
  type Check,
  type PrInfo,
  type PrState,
} from "./label";

const SOURCE = "gh-pr";

interface PaneCurrent {
  result?: {
    pane?: {
      pane_id?: string;
      cwd?: string;
      foreground_cwd?: string;
    };
  };
}

// Resolve the focused pane id and its working directory from herdr.
async function focusedPane(): Promise<{ paneId: string; cwd: string } | null> {
  const out = await $`herdr pane current`.nothrow().quiet();
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
  return { paneId, cwd };
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
async function prInfo(cwd: string, branch: string): Promise<PrInfo | null> {
  const out = await $`gh pr view ${branch} --json number,state,isDraft`.cwd(cwd).nothrow().quiet();
  if (out.exitCode !== 0) return null;
  try {
    const data = JSON.parse(out.stdout.toString()) as {
      number: number;
      state: PrState;
      isDraft: boolean;
    };
    return { number: data.number, state: data.state, isDraft: data.isDraft };
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

export async function run(): Promise<void> {
  const pane = await focusedPane();
  if (!pane) return;

  const branch = await currentBranch(pane.cwd);
  if (!branch) {
    // Left a repo (or detached HEAD), drop any stale label on this pane.
    await clearLabel(pane.paneId);
    return;
  }

  const pr = await prInfo(pane.cwd, branch);
  if (!pr) {
    // Branch has no PR, show nothing rather than a stale label.
    await clearLabel(pane.paneId);
    return;
  }

  const checks = await prChecks(pane.cwd, branch);
  const label = composeLabel(pr, rollupChecks(checks));
  await setLabel(pane.paneId, label);
}
