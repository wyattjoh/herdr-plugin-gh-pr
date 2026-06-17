import { expect, test } from "bun:test";
import { throttleElapsed } from "../src/throttle";

test("throttleElapsed is true when no prior check (last = 0)", () => {
  expect(throttleElapsed(0, 30_000, 30_000)).toBe(true);
});

test("throttleElapsed is false within the window", () => {
  expect(throttleElapsed(1000, 1000 + 29_999, 30_000)).toBe(false);
});

test("throttleElapsed is true exactly at the window boundary", () => {
  expect(throttleElapsed(1000, 1000 + 30_000, 30_000)).toBe(true);
});

test("throttleElapsed is true past the window", () => {
  expect(throttleElapsed(1000, 1000 + 45_000, 30_000)).toBe(true);
});
