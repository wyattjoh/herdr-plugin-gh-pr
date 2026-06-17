# herdr-plugin-gh-pr

A herdr plugin (v0.7.0+) that labels the focused **agent** pane's sidebar row with the GitHub PR status of that pane's current git branch.

## How it works

herdr exposes no overlay, status bar, or corner UI, and no background daemon. The only persistent ambient surface is the per-pane sidebar `custom_status` label (`pane.report_metadata`), which renders only for panes with a detected agent. Workspaces and tabs have no equivalent status-label mechanism (custom_status is pane-only), so the label lives on the agent pane. So this plugin is event-driven: herdr invokes `bin/update-pr-status.ts` on `pane.focused`, `worktree.opened`, and `worktree.created`. The script resolves the focused pane's cwd, derives the branch, queries `gh`, and writes the label.

While a refresh is in flight, the pane's icon is swapped for `⟳` (the PR number is kept), then it settles to the final CI symbol.

Actions: `refresh` re-runs the labeler on demand; `open-pr` opens the focused pane's branch PR in the browser (`bin/open-pr.ts`). herdr has no plugin-extensible right-click menu, so actions surface via the CLI or a `plugin_action` keybinding, not a context menu.

Manifest commands invoke `bun` explicitly (`["bun", "bin/..."]`) rather than relying on the script shebang + execute bit, which is undocumented for GitHub installs. Action `contexts` is `["workspace"]` (the only doc-confirmed value); the actions self-resolve the focused pane via `pane.current`, so they do not need a pane-scoped context. The plugin is single-file and dependency-free, so there is no `[[build]]` step.

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
- Force a label update on the focused pane: `herdr plugin action invoke gh-pr.refresh` (or run `bin/update-pr-status.ts` directly inside a repo pane). Note the qualified id uses a dot (`gh-pr.refresh`), not a slash.
- Inspect logs: `herdr plugin log list gh-pr`

## Conventions

- Bun + TypeScript, no external npm dependencies.
- No em dashes in code, comments, or docs.
- Metadata `source` is always `gh-pr`.
