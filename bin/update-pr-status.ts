#!/usr/bin/env bun
import { run } from "../src/main";

// herdr invokes this per pane.focused / worktree.* event and for the refresh
// action (no args, focused pane). An optional pane id argument targets a
// specific pane. Never fail loudly, a noisy hook would spam every focus change.
run(process.argv[2]).catch((err) => {
  console.error(`[gh-pr] update failed: ${err}`);
});
