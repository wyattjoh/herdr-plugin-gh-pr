# Herdr Plugin System & Overlay/UI Capabilities — Research Report

**Target version:** herdr v0.7.0 (latest release, 2026-06-15), socket protocol 14.
**Verified against:** GitHub releases (`ogulcancelik/herdr`, v0.7.0 = Latest) and live docs at https://herdr.dev/docs/.
**Date:** 2026-06-17

## Executive Summary

herdr **has a real plugin system** (introduced as "local plugin v1" in v0.7.0). Plugins are
declared with a `herdr-plugin.toml` manifest plus executables, installed from GitHub or linked
locally, and they hook into events, expose actions, and can open managed terminal panes.

**However, the headline design assumption does not hold:** herdr has **no overlay/widget
rendering API, no status bar, and no corner-positionable UI surface for arbitrary content.**

- The docs state plainly: *"There is no separate plugin SDK or restricted command set. The entire
  Herdr CLI is the plugin API."* (https://herdr.dev/docs/plugins/)
- Plugin "panes" *"render as terminal processes only — there is no widget-based or non-terminal
  UI."* Placement controls layout behavior (`overlay`/`split`/`tab`/`zoomed`), **not** screen
  position. A plugin **cannot pin a status widget to the top-right corner.**
- There is **no configurable status bar or status line** in herdr's UI configuration
  (https://herdr.dev/docs/configuration/).

The closest native mechanisms for surfacing "GitHub PR status of the current branch" are:

1. **`pane.report_metadata` / `pane.report_agent` custom-status label** — display-only text that
   appears next to the pane/agent in herdr's sidebar (NOT a corner overlay, but it is persistent
   and the canonical way to surface ambient status). **Recommended primary surface.**
2. **`notification.show` with `position: "top-right"`** — a *transient* toast in the top-right of
   the herdr frame. Right corner, but it disappears; only fits "PR state changed" events, not a
   persistent widget.
3. **A managed `[[panes]]` entrypoint** (`placement = "overlay"` or `split`) running a TUI that
   prints PR status — a real terminal pane the user opens on demand, not an always-on corner HUD.

A true always-visible top-right HUD is **not achievable** within herdr's UI. The design should
pivot to the sidebar custom-status label (persistent) plus top-right toasts (on change).

---

## PRIORITY: Focused-pane tracking, focus-change events, reactive update

These three items drive the event-driven design (focused pane's repo/branch, refresh on
focus/branch change, slow CI poll). Evidence from https://herdr.dev/docs/socket-api/.

### P1. Focused pane cwd / branch

- **Get the focused pane:** `pane.current` returns the active focused pane's `PaneInfo` (or a
  caller-specified pane). `pane.list` returns all panes, each with `"focused": <bool>` — find the
  one where `focused == true`. `pane.get <pane_id>` reads a specific pane.
- **`PaneInfo` fields** (documented example): `pane_id`, `terminal_id`, `workspace_id`, `tab_id`,
  `focused` (bool), `agent_status`, `revision`. Plus the cwd fields described in prose:
  - `cwd` — *"the pane/workspace cwd used for labels, follow-cwd behavior, and restored session
    state."*
  - `foreground_cwd` — *"pane.get, pane.list, agent.get, and agent.list also expose
    `foreground_cwd` when Herdr can resolve the cwd of the process currently controlling the pane
    PTY."* This is the more accurate cwd when the user has `cd`'d inside the shell; prefer
    `foreground_cwd`, fall back to `cwd` when absent.
- **No git branch field exists on `PaneInfo`.** The plugin derives branch itself: from the resolved
  cwd, run `git -C <cwd> branch --show-current` (or `rev-parse --abbrev-ref HEAD`) and
  `gh pr view --json ...`. `pane.process_info` is the fallback for cwd resolution (shell pid +
  foreground processes with `pid`/`name`/`argv`/`cwd`).

**Recommended:** on each refresh, call `pane.current` → take `foreground_cwd || cwd` → shell git/gh
in that dir.

### P2. Focus-change / branch-change events

- **Focus-change push event EXISTS:** `events.subscribe` with subscription type `"pane.focused"`.
  The connection is **persistent/streaming** — *"Event subscriptions keep the connection open after
  the initial response,"* and the server pushes newline-delimited JSON event lines as they occur.
  Subscribe request (documented form):
  ```json
  {"id":"sub_1","method":"events.subscribe",
   "params":{"subscriptions":[{"type":"pane.focused","pane_id":"w1:p1"}]}}
  ```
  Related types that also matter for branch tracking: `worktree.opened`, `worktree.created`,
  `worktree.removed` (branch/worktree switches), `pane.moved`, `pane.closed`, `pane.exited`, and
  `workspace.focused`.
- **NO cwd-change or branch-change event exists.** Full pane event list (verbatim): `pane.created`,
  `pane.closed`, `pane.focused`, `pane.moved`, `pane.exited`, `pane.agent_detected`,
  `pane.output_matched`, `pane.agent_status_changed`. None fire when the user `cd`s or checks out a
  branch inside an already-focused pane.
- **Two documentation gaps the build must resolve empirically** (docs are silent — do not assume):
  1. **Global vs per-pane subscription:** the example pins a `pane_id`. The docs do **not** state
     whether `pane_id` is optional (subscribe to *all* focus changes) or required. Test by sending
     a `pane.focused` subscription with no `pane_id`; if it errors or yields nothing, fall back to
     `workspace.focused` + a `pane.list` sweep, or to polling.
  2. **Event payload shape:** the docs give no verbatim `pane.focused` payload. It is unknown
     whether the event embeds full `PaneInfo` (cwd included) or only `pane_id`. **Design defensively:
     on every focus event, call `pane.current`/`pane.get` to read the fresh `foreground_cwd`** rather
     than trusting the event to carry cwd.

**Polling fallback (and the CI-status poll):** because no cwd/branch event exists, the plugin must
also poll. Pattern: a slow timer (e.g. every 15–30s) calls `pane.current`, recomputes cwd→branch,
and re-runs `gh pr checks`/`gh pr view` for CI status. Detect change by diffing
`foreground_cwd` + branch + PR state against the last cached value; only re-render on a real diff.
The docs give **no explicit rate guidance**, but `gh` API calls are the real cost (GitHub rate
limits + latency), not the local socket — so throttle the `gh` poll, keep the socket
event-subscribe for instant focus reaction, and cache PR/CI results per (repo, branch).

### P3. Reactive overlay update

- **Update is push-from-plugin, not herdr-pull.** herdr never polls the plugin; the plugin writes
  to herdr's surfaces when it detects a change:
  - Persistent label: `pane.report_metadata` (or `pane.report_agent`) `custom_status` — call it
    again with new text to update the sidebar label. (No re-render API beyond re-reporting.)
  - Transient toast on state transition: `notification.show` `position:"top-right"`.
- **Flicker/throttle:** only re-report when the computed string actually changes (diff against last
  pushed value) to avoid sidebar churn. Decouple the fast path (focus event → branch lookup, cheap
  local git) from the slow path (CI poll → `gh`), so focus reactions stay instant while CI status
  trails. `pane.report_metadata` accepts `ttl_ms` — useful so a stale label self-clears if the
  plugin process dies. `notification.show` is rate-limited by herdr (`rate_limited` is a documented
  response reason), so reserve toasts for genuine PR/CI state changes, not every poll tick.

---

## 1. Plugin System

**Yes — full plugin system as of v0.7.0.** Source: https://herdr.dev/docs/plugins/ and
https://herdr.dev/docs/marketplace/.

### Authoring & packaging
- A plugin is a directory containing a `herdr-plugin.toml` manifest at its root (or a subdirectory)
  plus one or more **executables**. Minimal layout: `herdr-plugin.toml` + an executable.
- Commands are **argv arrays run directly from the plugin dir, NOT through a shell** — no shell
  expansion, globbing, or `$VAR` interpolation. (To run `gh`, invoke it as an argv element, or
  wrap your logic in a script executable the manifest points at.)

### Manifest: `herdr-plugin.toml`
Required top-level keys: `id`, `name`, `version` (semver), `min_herdr_version`.
Optional: `description`, `platforms` (`["linux","macos","windows"]`).

Section types:
| Section | Purpose |
|---|---|
| `[[build]]` | `command` + `platforms`; runs once during **GitHub install** before registration (not on local link). |
| `[[actions]]` | `id` (no dots), `title`, `contexts` (e.g. `["workspace"]`), `command`. Invokable workflows; globally qualified as `plugin.<id>.<action>`. |
| `[[events]]` | `on = "<event>"` (e.g. `worktree.created`), `command`. Hook reacting to herdr events. |
| `[[panes]]` | `id`, `title`, `placement` (`overlay` default \| `split` \| `tab` \| `zoomed`), `command`. A managed terminal pane. |
| `[[link_handlers]]` | `id`, `title`, `pattern` (regex), `action`. Modified-click URL handlers. |

### Install / lifecycle
CLI: `herdr plugin install <owner>/<repo>[/subdir] [--ref REF] [--yes]`, `list [--json]`,
`uninstall`, `enable`/`disable`, `link <path> [--disabled]`, `unlink`, `config-dir <id>`,
`action list|invoke`, `log list`, `pane open|focus|close`.

- Local dev loop: `herdr plugin link <path>` registers a plugin from disk without GitHub.
- Plugins can be enabled/disabled. There is no documented activate/teardown callback — "lifecycle"
  is driven by event hooks, action invocations, and managed-pane open/close, not by load/unload
  hooks.

### Discovery / marketplace
- The marketplace index is **not yet live**. Discovery signal: add the GitHub topic
  `herdr-plugin` to the repo. Future index will list id/name/description/platforms/repo link.

---

## 2. Overlay / UI Rendering — the critical constraint

**herdr does NOT expose an overlay or widget API for arbitrary content, and has no status bar.**

Evidence (https://herdr.dev/docs/plugins/):
- *"Panes render as terminal processes only — there is no widget-based or non-terminal UI."*
- *"Panes cannot be positioned in specific corners; placement options control layout behavior
  only."* `placement` values: `overlay`, `split`, `tab`, `zoomed`.
  - `overlay` (default): *"opens a temporary zoomed overlay over the active pane and restores the
    previous focus and zoom when it closes."* — i.e. a full-area takeover, then it closes. Not a
    persistent corner widget.
- After opening, a plugin pane becomes a standard pane and can be moved/resized via `pane.move` /
  `pane.resize` — but this is normal split-layout geometry within a tab, not free positioning, and
  it is not a floating always-on-top HUD.

Configuration (https://herdr.dev/docs/configuration/): UI customization covers sidebar width,
themes/colors, toasts, agent panel visibility/scope, mouse/keyboard, scrollback. **No status bar /
status line / custom-text-widget mechanism exists.** The sidebar is "the main Herdr dashboard"
(workspaces/tabs/panes/agent state) and is not a free-form widget host.

### Refresh/update model
There is no render loop a plugin pushes pixels to. The two push surfaces are:
- **Sidebar status label** — plugin pushes via `pane.report_metadata` / `pane.report_agent`
  (display-only `custom_status`). Persistent until updated. Plugin-driven, not polled.
- **Toasts** — plugin pushes via `notification.show`. Transient.

---

## 3. Data / Execution Model

- **Execution shapes:** event hooks (`[[events]]`) and actions (`[[actions]]`) are **invoked
  on-demand** (short-lived process per event/action). Managed panes (`[[panes]]`) are
  **long-running terminal processes** owned by herdr. Build commands run once at install.
- **Running shell commands like `gh`:** yes — commands are argv arrays; a script executable can
  shell out / call `gh`. (No shell layer, so wrap multi-step logic in a script the manifest points
  to.) The CLI/socket is the whole API; the plugin runs with normal OS process privileges.
- **Env vars injected** into hook/action/pane commands: `HERDR_SOCKET_PATH`, `HERDR_BIN_PATH`,
  `HERDR_ENV=1`, `HERDR_PLUGIN_ID`, `HERDR_PLUGIN_ROOT`, `HERDR_PLUGIN_CONFIG_DIR`,
  `HERDR_PLUGIN_STATE_DIR`, `HERDR_PLUGIN_CONTEXT_JSON`, plus `HERDR_PLUGIN_ACTION_ID` (actions),
  `HERDR_PLUGIN_EVENT` + `HERDR_PLUGIN_EVENT_JSON` (events), `HERDR_PLUGIN_ENTRYPOINT_ID` (panes).
- **Knowing "the current branch":** herdr does **not** expose git branch directly. The path is:
  1. Query `pane.current` (or `pane.get <id>`) over the socket → returns `cwd` and, when
     resolvable, `foreground_cwd` (cwd of the process controlling the pane PTY).
  2. Or `pane.process_info` → shell pid + foreground processes with `pid`, `name`, `argv/cmdline`,
     `cwd`.
  3. From that cwd, the plugin runs git itself: `git -C <cwd> rev-parse --abbrev-ref HEAD` (and
     `gh pr status` / `gh pr view`).
  `HERDR_PLUGIN_CONTEXT_JSON` for actions/events may also include the focused pane / worktree, but
  the exact schema is not documented online — treat the socket `pane.current` query as the reliable
  source of cwd.

---

## 4. Existing Examples

**None published.** The marketplace index is not live and the docs link no official or community
example plugins (no status/git/corner-widget samples). Discovery is via the `herdr-plugin` GitHub
topic, which can be searched once repos adopt it. This plugin would effectively be greenfield.

---

## 5. Relevant Socket API (protocol 14)

Newline-delimited JSON: request `{"id","method","params"}` → `{"id","result"}` or
`{"id","error":{code,message}}`. Source: https://herdr.dev/docs/socket-api/.

**Pane introspection (cwd / git detection):**
- `pane.current` — active focused pane (or caller-specified). Fields: `pane_id`, `terminal_id`,
  `workspace_id`, `tab_id`, `focused`, `agent_status`, `revision`, `cwd`, `foreground_cwd`.
  **No git branch field — derive branch from cwd via git.**
- `pane.get <pane_id>` — same `PaneInfo` shape for a specific pane.
- `pane.list` — array of `PaneInfo`.
- `pane.process_info` — shell pid, foreground pgid, foreground processes (`pid`, `name`,
  `argv/cmdline`, `cwd`).

**Event subscription:** `events.subscribe` with `params.subscriptions[].type`. Relevant types:
- `pane.focused` — fires when the user switches panes → re-detect branch / refresh PR status.
- `pane.created`, `pane.closed`, `pane.moved`, `pane.exited`.
- `worktree.created`, `worktree.opened`, `worktree.removed` — branch/worktree changes.
- `pane.agent_status_changed`, `pane.agent_detected`, `pane.output_matched`,
  `workspace.focused`/`created`/`closed`/`renamed`/`updated`.
- (There is **no** "cwd changed" or "git branch changed" event — the plugin must poll git, or
  re-check on `pane.focused`.)

**Surfacing status (the usable output channels):**
- `pane.report_metadata` — params: `pane_id`, `source`, `agent`, `title`, `display_agent`,
  `custom_status`, `state_labels{}`, `ttl_ms`. **Display-only.** `custom_status` is the persistent
  sidebar label. (CLI: `herdr pane report-metadata`.)
- `pane.report_agent` — params: `pane_id`, `source`, `agent`, `state`, `message`, `custom_status`.
  `state` is **semantic** (affects waits/notifications/rollups); `custom_status` is display text
  only. (CLI: `herdr pane report-agent ... --custom-status <text>`.)
- `notification.show` — params: `title` (required), `body` (≤240 chars), `position`
  (`top-left`/`top-right`/`bottom-left`/`bottom-right`, applies when `ui.toast.delivery="herdr"`),
  `sound` (`none`/`done`/`request`). Response reasons: `shown`, `disabled`, `rate_limited`,
  `no_foreground_client`, `busy`. **Transient toast — top-right is available here, but not
  persistent.**

**Plugin pane control:** `plugin.pane.open` (params: `plugin_id`, `entrypoint` = manifest
`[[panes]]` id, `placement`, `target_pane_id`, `env`, `focus`), `plugin.pane.focus`,
`plugin.pane.close`. **No sizing/positioning params.**

**Toast delivery config** (`ui.toast.delivery`, https://herdr.dev/docs/configuration/): `off`
(default), `herdr` (in-UI toast, supports `position`), `terminal` (escape sequences to
Ghostty/iTerm2/Kitty/WezTerm), `system` (OS notifier). `position` only applies to `herdr` delivery.
Toasts are transient and suppressed for the active tab.

---

## Design Implications & Recommendation

A "persistent PR-status widget pinned top-right" is **not buildable** as specified — herdr has no
overlay/widget/status-bar surface and panes can't be corner-pinned. Recommended pivot:

1. **Primary surface — persistent sidebar label.** A long-running plugin process (or a
   `pane.focused`-triggered hook) resolves the focused pane's `cwd` via `pane.current`, runs
   `git rev-parse --abbrev-ref HEAD` + `gh pr view --json state,number,...`, and pushes a concise
   label (e.g. `PR #123 ✓ approved`) via `pane.report_metadata` `custom_status`. This is persistent
   and the canonical ambient-status channel.
2. **Change events — top-right toast.** On PR-state transitions, fire `notification.show`
   `position:"top-right"` (requires the user's `ui.toast.delivery="herdr"`). This is the only
   top-right surface, but transient.
3. **On-demand detail — managed pane.** A `[[panes]]` entrypoint running a small TUI (`gh pr view`,
   checks, reviewers) the user opens via an action/keybinding when they want full detail.

Refresh: subscribe to `pane.focused`, `worktree.opened`/`created`, and poll on an interval (no
git/cwd-change event exists). Get cwd from `pane.current`; derive branch and PR status by shelling
out to `git`/`gh` from a script executable (commands are argv, no shell).

## Follow-up: custom_status semantics & background hosting

Evidence: https://herdr.dev/docs/socket-api/ (pane.report_metadata / report_agent) and
https://herdr.dev/docs/plugins/ (manifest section types).

### A) custom_status / pane.report_metadata semantics

1. **Per-pane and persistent until overwritten — YES.** `custom_status` is a pane-level display
   attribute. The docs describe it as visual only ("can show a short activity label like `indexing`
   without changing semantic behavior") and give no clear-on-blur behavior: it **stays set on the
   pane it was reported for regardless of which pane is focused.** Consequence for this design: when
   the user moves focus to pane B, pane A keeps its (now stale) `PR #...` label until we explicitly
   overwrite or clear it. **We must actively clear the old pane's label on focus change** (send
   `clear_custom_status: true` with the same `source` to pane A), or the sidebar will show stale PR
   labels on every previously-focused pane.

2. **`ttl_ms` — auto-expiry, range 1..86400000 ms (1 ms to 24 h).** Verbatim: *"Use ttl_ms for
   short-lived metadata. It must be between 1 and 86400000 milliseconds."* On expiry: *"When the TTL
   expires, Herdr removes that source's metadata and emits a presentation change if the visible pane
   presentation changed."* So a TTL **does** make a stale label self-clear if not refreshed — useful
   as a dead-man's switch (e.g. set ttl_ms a few × the poll interval so the label vanishes if the
   plugin process dies). Tradeoff: too short a TTL makes the label blink out between refreshes, so
   set TTL > refresh cadence.

3. **`source` namespaces the label; multiple sources can write one pane.** `source` is an identifier
   (≤80 chars, ASCII letters/digits/`:`/`.`/`_`/`-`). Each source's metadata is tracked separately:
   you remove your own override with `clear_custom_status: true` reported under the **same source**.
   No documented precedence between sources. So our plugin should use a stable dedicated source
   (e.g. `gh-pr`) so it only ever touches its own label and never clobbers an agent integration's
   status on the same pane. (`pane.report_metadata` also accepts `seq` for ordering.)

4. **Works on a plain shell pane — `agent` is an OPTIONAL guard, not a precondition.**
   `pane.report_metadata` params: `pane_id`, `source`, `agent` (optional), `title`, `display_agent`,
   `custom_status`, `state_labels`, `ttl_ms`, `seq`. Docs: *"Metadata reports are display-only"* and
   *"`agent` is an optional guard"* — there is no requirement that an agent be detected, so we can
   report a label for any `pane_id`, including a plain shell in a git repo.
   **Caveat (undocumented):** the docs do NOT explicitly confirm *where* a custom_status renders for
   a pane with no detected agent — whether the sidebar shows the label on a plain-shell row the same
   way it does for an agent row. This must be verified empirically against a real herdr session
   before committing to it as the sole surface. If plain-shell panes don't surface the label, the
   fallback is `display_agent` (give the row a synthetic agent name like `gh-pr`) so the pane gets a
   labelled row to hang the status on.

### B) Hosting a periodic background poll (no daemon entrypoint)

1. **No background/daemon/service/worker entrypoint exists.** Section types are exactly `[[build]]`,
   `[[actions]]`, `[[events]]`, `[[panes]]`, `[[link_handlers]]`. The docs state plugin v1 excludes
   non-terminal background services: *"Runtime action registration and native non-terminal plugin UI
   are not part of plugin v1."* `[[build]]` runs once at install; `[[actions]]`/`[[link_handlers]]`
   are on-demand one-shots; `[[events]]` hooks are short-lived one-shot commands; `[[panes]]` is the
   only long-running kind.

2. **A `[[panes]]` process is always visible — no headless/hidden pane.** All `placement` values
   (`overlay`/`split`/`tab`/`zoomed`) are visible layout; the docs describe no hidden mode. So the
   "long-running terminal process" option always shows a pane, which conflicts with a
   sidebar-label-only design.

3. **No timer/cron/interval/scheduler concept anywhere** in the plugin docs. Spawning a detached
   long-running child from a short-lived `[[events]]` hook is **not documented and not sanctioned** —
   it would be an unmanaged orphan herdr does not track (lifecycle, restart, teardown all become the
   plugin's problem), so treat it as unsupported rather than idiomatic.

4. **Idiomatic pattern = event-driven, hosted by a persistent socket client (not a manifest
   entrypoint).** Because there is no daemon entrypoint and no scheduler, the sanctioned shape is: a
   process that holds an open `events.subscribe` socket connection (the connection stays open and
   herdr pushes `pane.focused` / `worktree.*` lines) and recomputes on each event. The docs imply
   refresh is **event-driven**, not polled. For CI/check status that has no event, the practical
   approach is a self-managed interval **inside that same long-lived socket client** (it is already a
   running process holding the subscription), throttled because the cost is `gh`, not the socket.

   **The open design question this raises:** who runs that long-lived socket client? herdr's manifest
   gives no headless host for it. Options, in order of cleanliness:
   - (a) The user launches it (a `[[actions]]` "start" action, a login item, or `herdr` startup
     command) and it runs as an ordinary process using `HERDR_SOCKET_PATH`. Clean lifecycle, but
     requires the user to start it.
   - (b) A visible `[[panes]]` process that also does the socket work — but that reintroduces a
     visible pane, contradicting the sidebar-only goal.
   - (c) Pure event-only with NO periodic poll: a tiny `[[events]]` hook on `pane.focused` /
     `worktree.opened` that runs once per event (read cwd → git branch → `gh pr view` → report
     metadata, then exit). This fits the manifest perfectly and needs no daemon, but **loses
     background CI refresh** — the label only updates when focus/worktree changes, so CI status can
     lag until the next focus event. Given "slow CI poll" is a stated requirement, pure (c) is
     insufficient on its own.

   **Recommendation:** event hooks (c) for the focus/branch path (idiomatic, zero daemon), plus a
   user-started long-lived socket client (a) to own the CI poll and the open subscription. If a
   user-started process is unacceptable, accept event-only refresh (c) and drop or coarsen the CI
   poll (e.g. refresh CI lazily on each focus event instead of on a timer).

## Sources
- https://herdr.dev/docs/ (TOC)
- https://herdr.dev/docs/plugins/ (manifest, panes, placement, "terminal processes only", "entire CLI is the plugin API")
- https://herdr.dev/docs/socket-api/ (pane.current/get/list/process_info, events.subscribe, report_metadata/report_agent, notification.show, plugin.pane.*)
- https://herdr.dev/docs/configuration/ (no status bar; ui.toast.delivery + position)
- https://herdr.dev/docs/agents/ (custom_status is display-only label)
- https://herdr.dev/docs/marketplace/ (no example plugins; herdr-plugin topic)
- GitHub `ogulcancelik/herdr` releases — v0.7.0 confirmed Latest (2026-06-15)
