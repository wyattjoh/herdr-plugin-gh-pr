#!/usr/bin/env bun
import { run } from "../src/main";

// herdr invokes this per pane.focused / worktree.* event and for the refresh
// action (no args, focused pane). An optional pane id argument targets a
// specific pane. The refresh action sets HERDR_PLUGIN_ACTION_ID, which forces
// an update past the per-pane throttle; events stay throttled.
// Never fail loudly, a noisy hook would spam every focus change.
const force = Boolean(process.env.HERDR_PLUGIN_ACTION_ID);
run(process.argv[2], force).catch((err) => {
  console.error(`[gh-pr] update failed: ${err}`);
});
