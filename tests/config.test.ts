import { expect, test } from "bun:test";
import { DEFAULT_CONFIG, parseConfig } from "../src/config";

test("parseConfig returns defaults for empty or non-object input", () => {
  expect(parseConfig(undefined)).toEqual(DEFAULT_CONFIG);
  expect(parseConfig(null)).toEqual(DEFAULT_CONFIG);
  expect(parseConfig("nope")).toEqual(DEFAULT_CONFIG);
  expect(parseConfig([])).toEqual(DEFAULT_CONFIG);
  expect(parseConfig({})).toEqual(DEFAULT_CONFIG);
});

test("parseConfig reads valid mode and format", () => {
  expect(parseConfig({ repoName: { mode: "always", format: "full" } })).toEqual({
    repoName: { mode: "always", format: "full" },
  });
  expect(parseConfig({ repoName: { mode: "never", format: "short" } })).toEqual({
    repoName: { mode: "never", format: "short" },
  });
});

test("parseConfig falls back per-field on invalid values", () => {
  expect(parseConfig({ repoName: { mode: "bogus", format: "full" } })).toEqual({
    repoName: { mode: DEFAULT_CONFIG.repoName.mode, format: "full" },
  });
  expect(parseConfig({ repoName: { mode: "always", format: 42 } })).toEqual({
    repoName: { mode: "always", format: DEFAULT_CONFIG.repoName.format },
  });
});
