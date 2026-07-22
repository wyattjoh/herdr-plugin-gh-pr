# herdr-plugin-gh-pr

Shows the GitHub PR status of the focused **agent** pane's current git branch as a label on that pane's row in the herdr sidebar. The label reads like `#123 ✓` (the PR number plus a compact status symbol: ✓ passing CI, ✗ failing CI, ● pending CI, ◆ merged, ⊘ closed, and no symbol for an open PR with no checks). While the status is being recomputed, the symbol is replaced with `⟳`.

## Requirements

- herdr >= 0.7.4
- `bun`, `git`, and `gh` (authenticated: `gh auth status`) on your PATH

## Install

From GitHub (your local git must have access, the repo is private):

```bash
herdr plugin install wyattjoh/herdr-plugin-gh-pr
```

Or link a local checkout for development:

```bash
herdr plugin link /path/to/herdr-plugin-gh-pr
```

That is the entire install. No daemon, no config. herdr runs the hooks with `bun`, so `bun` must be on your PATH.

### Optional keybindings

herdr has no plugin-extensible right-click menu, and a plugin cannot ship its own keybinding (the manifest has no `key` field and keybindings live only in the user's config). To trigger the actions with a keystroke, add them to `~/.config/herdr/config.toml` and run `herdr server reload-config`:

```toml
[[keys.command]]
key = "prefix+u"
type = "plugin_action"
command = "gh-pr.open-pr"
description = "open PR in browser"

[[keys.command]]
key = "prefix+i"
type = "plugin_action"
command = "gh-pr.refresh"
description = "refresh PR status"
```

Then press your prefix (default `ctrl+b`) followed by `u` (open PR) or `i` (refresh status). Avoid `alt+` chords (they emit characters in the terminal), and pick a key that does not collide with a built-in: `o` (notifications), `g` (goto), `r` (resize), `v` (split), and `e` (edit scrollback) are taken by default. `herdr server reload-config` reports any conflict as a `partial` status.

## Sidebar setup

The plugin writes its label to a named `pr` token (`pane.report_metadata --token pr=VALUE`). herdr's
packed sidebar row layout only shows tokens you place in your row config, so add `$pr` to a row in
`~/.config/herdr/config.toml`, then run `herdr server reload-config`. Without `$pr` in a row, the
token is still written but nothing renders it.

Where you put `$pr` is up to you — the sidebar is narrow, so the label competes for width with
whatever shares its row. Pick the layout that fits; all three are valid:

```toml
# Compact: label shares the workspace row (fine for short "#123 ✓" labels,
# but a long or repo-prefixed label like "workspace #123 ✓" gets truncated).
[ui.sidebar.agents]
rows = [["state_icon", "workspace", "$pr"], ["agent"]]

# Label replaces the agent name on its own full-width row (recommended when
# using the repo-name prefix — see Configuration).
rows = [["state_icon", "workspace"], ["$pr"]]

# Label on a dedicated third row, keeping the agent name.
rows = [["state_icon", "workspace"], ["agent"], ["$pr"]]
```

## Use

Focus an agent pane sitting in a git repo whose branch has a PR. The label appears and refreshes when you switch panes or open/create worktrees. To avoid hammering the GitHub API, the automatic path checks at most once per pane every 30 seconds; a manual refresh always updates immediately.

### Submodules

If the pane's own repo has no PR on its current branch, the plugin also checks each initialized git submodule (via `git submodule status --recursive`) and labels the first one whose branch has a PR. This covers monorepo/superproject setups where the working branch and its PR live inside a submodule while the outer worktree sits on a plain branch. The pane's own repo always wins when both have a PR, and repos without submodules are unaffected.

When the PR comes from a submodule, the label is prefixed with the PR's repo name so you can tell which repo it belongs to (e.g. `workspace #123 ✓`). This is configurable — see below.

## Configuration

Optional. The plugin reads `config.json` from its config dir (`herdr plugin config-dir gh-pr`, i.e. `~/.config/herdr/plugins/config/gh-pr/config.json`). Missing or invalid config falls back to the defaults, so you only set what you want to change.

```json
{
  "repoName": {
    "mode": "submodule",
    "format": "short"
  }
}
```

- `repoName.mode` — when to prefix the label with the PR's repo name:
  - `"submodule"` *(default)* — only when the PR was found in a submodule (a different repo than the pane's own), the case where "which repo?" is ambiguous.
  - `"always"` — always, even for the pane's own repo.
  - `"never"` — never; the label stays `#123 ✓`.
- `repoName.format` — `"short"` *(default)* shows the repo name only (`workspace`); `"full"` shows `owner/name` (`mobile-club/workspace`).

Changes take effect on the next refresh (switch panes or `herdr plugin action invoke gh-pr.refresh`).

Refresh the focused pane's PR status on demand:

```bash
herdr plugin action invoke gh-pr.refresh
```

Open the focused pane's branch PR in the browser:

```bash
herdr plugin action invoke gh-pr.open-pr
```

The qualified action id uses a dot (`gh-pr.open-pr`), not a slash.

## Develop

- `bun test` runs the unit tests.
- `herdr plugin log list gh-pr` shows hook output.
