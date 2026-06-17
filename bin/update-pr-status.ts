#!/usr/bin/env bun
import { run } from "../src/main";

// herdr invokes this per pane.focused / worktree.* event and for the refresh
// action. Never fail loudly, a noisy hook would spam every focus change.
run().catch((err) => {
  console.error(`[gh-pr] update failed: ${err}`);
});
