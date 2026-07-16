import { expect, test } from "bun:test";
import {
  composeLabel,
  parsePrNumber,
  refreshingLabel,
  resolvePaneCwd,
  rollupChecks,
} from "../src/label";

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

test("composeLabel shows the number and a passing CI tick", () => {
  expect(composeLabel(123, "pass")).toBe("#123 ✓");
});

test("composeLabel shows a failing CI cross", () => {
  expect(composeLabel(7, "fail")).toBe("#7 ✗");
});

test("composeLabel shows a pending CI dot", () => {
  expect(composeLabel(7, "pending")).toBe("#7 ●");
});

test("composeLabel omits the CI symbol when there are no checks", () => {
  expect(composeLabel(7, "none")).toBe("#7");
});

test("composeLabel shows a merged PR icon instead of CI status", () => {
  expect(composeLabel(9, "fail", "MERGED")).toBe("#9 ◆");
});

test("composeLabel shows a closed PR icon instead of CI status", () => {
  expect(composeLabel(9, "pending", "CLOSED")).toBe("#9 ⊘");
});

test("parsePrNumber extracts the number from an existing label", () => {
  expect(parsePrNumber("#123 ✓")).toBe(123);
  expect(parsePrNumber("#7 ⟳")).toBe(7);
  expect(parsePrNumber("#9")).toBe(9);
});

test("parsePrNumber returns null when there is no PR number", () => {
  expect(parsePrNumber(undefined)).toBeNull();
  expect(parsePrNumber(null)).toBeNull();
  expect(parsePrNumber("")).toBeNull();
  expect(parsePrNumber("cli")).toBeNull();
});

test("refreshingLabel keeps the number and shows the refreshing glyph", () => {
  expect(refreshingLabel(123)).toBe("#123 ⟳");
});

test("resolvePaneCwd prefers cwd over foreground_cwd on agent panes", () => {
  // Regression test: an agent's foreground process (e.g. Claude Code) can run
  // from a transient sandbox dir like /tmp, which is not the project repo.
  // Picking foreground_cwd there made currentBranch() fail and clearLabel()
  // wipe a correct, already-set PR label every time the pane was focused.
  expect(
    resolvePaneCwd({ cwd: "/home/user/project", foreground_cwd: "/tmp" }),
  ).toBe("/home/user/project");
});

test("resolvePaneCwd falls back to foreground_cwd when cwd is absent", () => {
  expect(resolvePaneCwd({ foreground_cwd: "/home/user/project" })).toBe(
    "/home/user/project",
  );
});

test("resolvePaneCwd returns undefined when neither is present", () => {
  expect(resolvePaneCwd({})).toBeUndefined();
});
