#!/usr/bin/env bun
import { openPr } from "../src/main";

// Invoked by the open-pr action (no args, focused pane) or with an optional
// pane id argument. Opens the pane's branch PR in the browser.
openPr(process.argv[2]).catch((err) => {
  console.error(`[gh-pr] open failed: ${err}`);
});
