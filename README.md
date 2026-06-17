# herdr-plugin-gh-pr

Shows the GitHub PR status of the focused **agent** pane's current git branch as a label on that pane's row in the herdr sidebar. The label reads like `PR #123 open ✓` (✓ CI passing, ✗ failing, ● pending, no symbol when there are no checks; merged/closed PRs show no CI symbol).

## Why a sidebar label and not a top-right overlay

herdr (v0.7.0) has no overlay, status bar, or corner-pinnable UI, and no plugin background daemon. The per-pane sidebar `custom_status` label is the only persistent ambient surface a plugin can drive, and it renders only for panes that have a detected agent. The plugin is fully event-driven, herdr invokes it on focus and worktree changes; there is nothing to start. See `docs/research/herdr-plugin-overlay.md` for the capability research.

## Requirements

- herdr >= 0.7.0
- `bun`, `git`, and `gh` (authenticated: `gh auth status`) on your PATH

## Install

```bash
herdr plugin link /path/to/herdr-plugin-gh-pr
```

That is the entire install. No daemon, no config.

## Use

Focus an agent pane sitting in a git repo whose branch has a PR. The label appears and refreshes when you switch panes or open/create worktrees. To refresh CI status while staying on one pane (herdr has no background poll), run:

```bash
herdr plugin action invoke gh-pr/refresh
```

## Develop

- `bun test` runs the unit tests.
- `herdr plugin log list gh-pr` shows hook output.
