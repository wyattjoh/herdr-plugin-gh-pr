# herdr-plugin-gh-pr

Shows the GitHub PR status of the focused **agent** pane's current git branch as a label on that pane's row in the herdr sidebar. The label reads like `#123 ✓` (the PR number plus a CI rollup symbol: ✓ passing, ✗ failing, ● pending, and no symbol when there are no checks).

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
herdr plugin action invoke gh-pr.refresh
```

To open the focused pane's branch PR in the browser:

```bash
herdr plugin action invoke gh-pr.open-pr
```

The qualified action id uses a dot (`gh-pr.open-pr`), not a slash. herdr has no plugin-extensible right-click menu, and a plugin cannot ship its own keybinding (the manifest has no `key` field and keybindings live only in the user's config). So to trigger an action with a keystroke, the user binds it in `~/.config/herdr/config.toml` and runs `herdr server reload-config`:

```toml
[[keys.command]]
key = "prefix+alt+p"
type = "plugin_action"
command = "gh-pr.open-pr"
description = "open PR in browser"
```

Then press your prefix (default `ctrl+b`) followed by `alt+p`. Pick a key that does not collide with a built-in (single letters like `o` and `g` are taken; the reload reports conflicts).

## Develop

- `bun test` runs the unit tests.
- `herdr plugin log list gh-pr` shows hook output.
