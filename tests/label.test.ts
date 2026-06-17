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
