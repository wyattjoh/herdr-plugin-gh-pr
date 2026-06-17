# herdr-plugin-gh-pr Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A herdr plugin that labels the focused agent pane's sidebar row with the GitHub PR status (number, state, CI rollup) of that pane's current git branch, refreshed automatically when you switch panes or worktrees.

**Architecture:** herdr has no overlay, status bar, or corner-pinnable UI, and no background-daemon entrypoint (verified against v0.7.0 docs + a live herdr session, see `docs/research/herdr-plugin-overlay.md`). The only persistent ambient surface is the per-pane sidebar `custom_status` label set via the `pane.report_metadata` socket call, and it only renders for panes that have a detected agent. So the plugin is purely event-driven: herdr-hosted `[[events]]` hooks invoke a short-lived Bun script on `pane.focused` / `worktree.opened` / `worktree.created`. The script reads the focused pane's working directory, derives the branch, queries `gh` for the PR and CI status, and writes the label. A manual `refresh` action covers refreshing CI while idle (replacing the impossible background poll). Nothing needs to be started; `herdr plugin link` is the whole install.

**Tech Stack:** Bun + TypeScript, the herdr CLI (`herdr pane current`, `herdr pane report-metadata`), `git`, and the GitHub CLI (`gh pr view`, `gh pr checks`). Tests use Bun's built-in `bun:test`.

## Global Constraints

- `min_herdr_version = "0.7.0"`; relies on socket protocol 14 (`pane.current`, `pane.report_metadata`, `[[events]]` hooks).
- Runtime is Bun + TypeScript (user default). No external npm dependencies; use only `bun:*` built-ins and the system `herdr`/`git`/`gh` binaries.
- The plugin must require nothing special to run: no daemon, no user-started process, no `ui.toast.delivery` config. Install is `herdr plugin link <path>` only.
- The label is written under a dedicated metadata `source` of exactly `gh-pr`, so it never clobbers an agent integration's own `custom_status`.
- Only agent panes render `custom_status` in the sidebar; plain-shell panes do not appear there. The plugin still reports unconditionally (harmless, idempotent) and does not try to gate on agent presence.
- No em dashes anywhere in code, comments, commit messages, or docs. Use commas, parentheses, or separate sentences.
- Conventional Commits for every commit.

---

### Task 1: Scaffold the plugin

**Files:**
- Create: `herdr-plugin.toml`
- Create: `package.json`
- Create: `CLAUDE.md`
- Create: `AGENTS.md` (symlink to `CLAUDE.md`)
- Create: `.gitignore`

**Interfaces:**
- Consumes: nothing (greenfield; repo already `git init`-ed on branch `main`).
- Produces: a linkable plugin directory. Manifest `[[events]]` and `[[actions]]` entries point at `bin/update-pr-status.ts` (created in Task 3); linking before that file exists is fine, herdr only invokes it on events.

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "herdr-plugin-gh-pr",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "description": "herdr plugin that shows the focused agent pane's branch PR status in the sidebar",
  "scripts": {
    "test": "bun test"
  }
}
```

- [ ] **Step 2: Create `herdr-plugin.toml`**

```toml
id = "gh-pr"
name = "GitHub PR Status"
version = "0.1.0"
min_herdr_version = "0.7.0"
description = "Labels the focused agent pane's sidebar row with its branch's GitHub PR status."
platforms = ["macos", "linux"]

# Refresh when the user switches panes.
[[events]]
on = "pane.focused"
command = ["bin/update-pr-status.ts"]

# Refresh when a worktree (branch) is opened or created.
[[events]]
on = "worktree.opened"
command = ["bin/update-pr-status.ts"]

[[events]]
on = "worktree.created"
command = ["bin/update-pr-status.ts"]

# Manual refresh, covers updating CI status while idle on one pane
# (herdr has no background-poll mechanism).
[[actions]]
id = "refresh"
title = "Refresh PR status"
contexts = ["pane"]
command = ["bin/update-pr-status.ts"]
```

- [ ] **Step 3: Create `.gitignore`**

```gitignore
node_modules/
*.log
```

- [ ] **Step 4: Create `CLAUDE.md`**

```markdown
# herdr-plugin-gh-pr

A herdr plugin (v0.7.0+) that labels the focused **agent** pane's sidebar row with the GitHub PR status of that pane's current git branch.

## How it works

herdr exposes no overlay, status bar, or corner UI, and no background daemon. The only persistent ambient surface is the per-pane sidebar `custom_status` label (`pane.report_metadata`), which renders only for panes with a detected agent. So this plugin is event-driven: herdr invokes `bin/update-pr-status.ts` on `pane.focused`, `worktree.opened`, and `worktree.created`. The script resolves the focused pane's cwd, derives the branch, queries `gh`, and writes the label. A `refresh` action refreshes on demand.

See `docs/research/herdr-plugin-overlay.md` for the full capability research and citations.

## Layout

- `herdr-plugin.toml` - manifest (events, action).
- `bin/update-pr-status.ts` - executable entrypoint herdr invokes per event/action.
- `src/label.ts` - pure label-composition logic (unit tested).
- `src/main.ts` - orchestration and IO (herdr/git/gh).
- `tests/label.test.ts` - unit tests for the pure logic.

## Develop

- Install locally: `herdr plugin link .`
- Run tests: `bun test`
- Force a label update on the focused pane: `herdr plugin action invoke gh-pr/refresh` (or run `bin/update-pr-status.ts` directly inside a repo pane).
- Inspect logs: `herdr plugin log list gh-pr`

## Conventions

- Bun + TypeScript, no external npm dependencies.
- No em dashes in code, comments, or docs.
- Metadata `source` is always `gh-pr`.
```

- [ ] **Step 5: Create the `AGENTS.md` symlink**

Run:
```bash
ln -s CLAUDE.md AGENTS.md
```

- [ ] **Step 6: Verify the plugin links**

Run:
```bash
herdr plugin link . && herdr plugin list --json
```
Expected: output includes a plugin with `"id": "gh-pr"`. (If a previous link exists, run `herdr plugin unlink gh-pr` first.)

- [ ] **Step 7: Commit**

```bash
git add herdr-plugin.toml package.json CLAUDE.md AGENTS.md .gitignore
git commit -m "feat: scaffold herdr gh-pr plugin manifest and project files"
```

---

### Task 2: Pure label-composition logic

**Files:**
- Create: `src/label.ts`
- Test: `tests/label.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces, imported by `src/main.ts` in Task 3:
  - `type PrState = "OPEN" | "CLOSED" | "MERGED"`
  - `interface PrInfo { number: number; state: PrState; isDraft: boolean }`
  - `type CheckBucket = "pass" | "fail" | "pending" | "skipping" | "cancel"`
  - `interface Check { bucket: CheckBucket }`
  - `type CiRollup = "pass" | "fail" | "pending" | "none"`
  - `function rollupChecks(checks: Check[]): CiRollup`
  - `function composeLabel(pr: PrInfo, ci: CiRollup): string`

- [ ] **Step 1: Write the failing tests**

Create `tests/label.test.ts`:
```ts
import { expect, test } from "bun:test";
import { composeLabel, rollupChecks } from "../src/label";

test("rollupChecks returns none for an empty list", () => {
  expect(rollupChecks([])).toBe("none");
});

test("rollupChecks returns pass when every check passes or skips", () => {
  expect(rollupChecks([{ bucket: "pass" }, { bucket: "skipping" }])).toBe("pass");
});

test("rollupChecks returns pending when any check is pending", () => {
  expect(rollupChecks([{ bucket: "pass" }, { bucket: "pending" }])).toBe("pending");
});

test("rollupChecks returns fail when any check fails or is cancelled, even with pending present", () => {
  expect(rollupChecks([{ bucket: "pending" }, { bucket: "fail" }])).toBe("fail");
  expect(rollupChecks([{ bucket: "pass" }, { bucket: "cancel" }])).toBe("fail");
});

test("composeLabel shows number, state, and a passing CI tick", () => {
  expect(composeLabel({ number: 123, state: "OPEN", isDraft: false }, "pass")).toBe("PR #123 open ✓");
});

test("composeLabel shows a failing CI cross", () => {
  expect(composeLabel({ number: 7, state: "OPEN", isDraft: false }, "fail")).toBe("PR #7 open ✗");
});

test("composeLabel shows a pending CI dot", () => {
  expect(composeLabel({ number: 7, state: "OPEN", isDraft: false }, "pending")).toBe("PR #7 open ●");
});

test("composeLabel omits the CI symbol when there are no checks", () => {
  expect(composeLabel({ number: 7, state: "OPEN", isDraft: false }, "none")).toBe("PR #7 open");
});

test("composeLabel labels a draft PR", () => {
  expect(composeLabel({ number: 9, state: "OPEN", isDraft: true }, "pending")).toBe("PR #9 draft ●");
});

test("composeLabel labels merged and closed PRs and drops CI for them", () => {
  expect(composeLabel({ number: 9, state: "MERGED", isDraft: false }, "pass")).toBe("PR #9 merged");
  expect(composeLabel({ number: 9, state: "CLOSED", isDraft: false }, "fail")).toBe("PR #9 closed");
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test tests/label.test.ts`
Expected: FAIL, cannot resolve `../src/label` (module not found).

- [ ] **Step 3: Write the implementation**

Create `src/label.ts`:
```ts
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test tests/label.test.ts`
Expected: PASS, all 10 tests.

- [ ] **Step 5: Commit**

```bash
git add src/label.ts tests/label.test.ts
git commit -m "feat: add pure PR-status label composition with tests"
```

---

### Task 3: Orchestration, IO, and the entrypoint

**Files:**
- Create: `src/main.ts`
- Create: `bin/update-pr-status.ts`

**Interfaces:**
- Consumes from Task 2: `composeLabel`, `rollupChecks`, and the `PrInfo` / `Check` / `PrState` types from `src/label.ts`.
- Produces: `async function run(): Promise<void>` exported from `src/main.ts`, called by the `bin/update-pr-status.ts` shim. herdr invokes `bin/update-pr-status.ts` per event/action.

- [ ] **Step 1: Write `src/main.ts`**

Create `src/main.ts`:
```ts
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
```

- [ ] **Step 2: Write the entrypoint `bin/update-pr-status.ts`**

Create `bin/update-pr-status.ts`:
```ts
#!/usr/bin/env bun
import { run } from "../src/main";

// herdr invokes this per pane.focused / worktree.* event and for the refresh
// action. Never fail loudly, a noisy hook would spam every focus change.
run().catch((err) => {
  console.error(`[gh-pr] update failed: ${err}`);
});
```

- [ ] **Step 3: Make the entrypoint executable**

Run:
```bash
chmod +x bin/update-pr-status.ts
```
(Git preserves the execute bit, so local `herdr plugin link` and a future GitHub install both get an executable hook.)

- [ ] **Step 4: Smoke-test the script directly**

Run, from inside this repo's pane:
```bash
bin/update-pr-status.ts; echo "exit: $?"
```
Expected: `exit: 0`. Because this repo currently has no PR for its branch, the script clears the label and exits cleanly. Confirm no stack trace printed. (A non-zero exit or a thrown error here is a real failure to fix before committing.)

- [ ] **Step 5: Verify the label clears for a no-PR branch**

Run:
```bash
herdr pane current | python3 -c 'import sys,json; print(json.load(sys.stdin)["result"]["pane"].get("custom_status"))'
```
Expected: `None` (no `gh-pr` label set, because the branch has no PR). This confirms the clear path ran.

- [ ] **Step 6: Commit**

```bash
git add src/main.ts bin/update-pr-status.ts
git commit -m "feat: resolve focused pane branch and write PR status label"
```

---

### Task 4: End-to-end verification against a real PR

**Files:**
- Create: `README.md`

**Interfaces:**
- Consumes: the linked plugin from Task 1 and the entrypoint from Task 3.
- Produces: nothing code-facing; this task proves the plugin works in a live herdr session and documents it.

- [ ] **Step 1: Pick or create a repo with an open PR**

Use any local clone of a GitHub repo that has an open PR on a branch you can check out. Open it in a herdr pane running an agent (the sidebar only renders `custom_status` for agent panes, so a plain shell will not show the label). Check out the PR's branch in that pane.

- [ ] **Step 2: Trigger a refresh via the action**

Run:
```bash
herdr plugin action invoke gh-pr/refresh
```
Expected: exit 0.

- [ ] **Step 3: Confirm the label renders**

Look at the herdr sidebar row for that agent pane. Expected: it shows `PR #<number> <state> <symbol>`, for example `PR #482 open ✓`. Cross-check the symbol against `gh pr checks <branch>` run in the same dir (✓ all pass, ✗ any fail, ● any pending, no symbol if there are no checks).

- [ ] **Step 4: Confirm automatic refresh on focus change**

Focus a different pane, then focus the PR pane again. Expected: the label is present (re-applied by the `pane.focused` hook). Then check out a branch with no PR in that pane and invoke `herdr plugin action invoke gh-pr/refresh`. Expected: the label disappears (cleared).

- [ ] **Step 5: Inspect plugin logs if anything misbehaves**

Run:
```bash
herdr plugin log list gh-pr
```
Use this to debug a missing label (look for `[gh-pr] update failed` lines or non-zero hook exits).

- [ ] **Step 6: Write `README.md`**

```markdown
# herdr-plugin-gh-pr

Shows the GitHub PR status of the focused **agent** pane's current git branch as a label on that pane's row in the herdr sidebar. The label reads like `PR #123 open ✓` (✓ CI passing, ✗ failing, ● pending, no symbol when there are no checks; merged/closed PRs show no CI symbol).

## Why a sidebar label and not a top-right overlay

herdr (v0.7.0) has no overlay, status bar, or corner-pinnable UI, and no plugin background daemon. The per-pane sidebar `custom_status` label is the only persistent ambient surface a plugin can drive, and it renders only for panes that have a detected agent. The plugin is fully event-driven, herdr invokes it on focus and worktree changes; there is nothing to start. See `docs/research/herdr-plugin-overlay.md` for the capability research.

## Requirements

- herdr >= 0.7.0
- `bun`, `git`, and `gh` (authenticated: `gh auth status`) on your PATH

## Install

\`\`\`bash
herdr plugin link /path/to/herdr-plugin-gh-pr
\`\`\`

That is the entire install. No daemon, no config.

## Use

Focus an agent pane sitting in a git repo whose branch has a PR. The label appears and refreshes when you switch panes or open/create worktrees. To refresh CI status while staying on one pane (herdr has no background poll), run:

\`\`\`bash
herdr plugin action invoke gh-pr/refresh
\`\`\`

## Develop

- `bun test` runs the unit tests.
- `herdr plugin log list gh-pr` shows hook output.
```

- [ ] **Step 7: Commit**

```bash
git add README.md
git commit -m "docs: add README and verify end-to-end PR status labeling"
```

---

## Self-Review Notes

- **Spec coverage:** focused-pane scope (Task 3 `focusedPane` via `pane.current`), PR state + number content (Task 2 `composeLabel`), CI checks rollup (Task 2 `rollupChecks` from `gh pr checks` buckets), refresh on pane/branch change (Task 1 `pane.focused` / `worktree.*` hooks), no special hosting (event-driven, no daemon, per Global Constraints and the preview-docs review). The original "top-right overlay" is unbuildable in herdr and was redesigned to the sidebar label with the user's approval; documented in README and CLAUDE.md.
- **No background poll:** intentionally omitted because herdr offers no daemon/timer entrypoint. The `refresh` action is the sanctioned manual substitute.
- **Type consistency:** `PrInfo`, `Check`, `CiRollup`, `rollupChecks`, `composeLabel` names and signatures match between Task 2 (definition) and Task 3 (use).
- **Known doc gap accepted:** `pane.focused` event payload shape is undocumented, so Task 3 ignores the event JSON and always re-reads `herdr pane current` for the authoritative pane id + cwd.
