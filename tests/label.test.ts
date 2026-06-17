import { expect, test } from "bun:test";
import { composeLabel, rollupChecks } from "../src/label";

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

test("composeLabel shows number, state, and a passing CI tick", () => {
  expect(composeLabel({ number: 123, state: "OPEN", isDraft: false }, "pass")).toBe("PR #123 open ✓");
});

test("composeLabel shows a failing CI cross", () => {
  expect(composeLabel({ number: 7, state: "OPEN", isDraft: false }, "fail")).toBe("PR #7 open ✗");
});

test("composeLabel shows a pending CI dot", () => {
  expect(composeLabel({ number: 7, state: "OPEN", isDraft: false }, "pending")).toBe("PR #7 open ●");
});

test("composeLabel omits the CI symbol when there are no checks", () => {
  expect(composeLabel({ number: 7, state: "OPEN", isDraft: false }, "none")).toBe("PR #7 open");
});

test("composeLabel labels a draft PR", () => {
  expect(composeLabel({ number: 9, state: "OPEN", isDraft: true }, "pending")).toBe("PR #9 draft ●");
});

test("composeLabel labels merged and closed PRs and drops CI for them", () => {
  expect(composeLabel({ number: 9, state: "MERGED", isDraft: false }, "pass")).toBe("PR #9 merged");
  expect(composeLabel({ number: 9, state: "CLOSED", isDraft: false }, "fail")).toBe("PR #9 closed");
});
