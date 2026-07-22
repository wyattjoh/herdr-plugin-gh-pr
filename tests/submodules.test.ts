import { expect, test } from "bun:test";
import { parseSubmodulePaths } from "../src/submodules";

test("parseSubmodulePaths resolves in-sync entries against the root", () => {
  const out = " 1111111111111111111111111111111111111111 packages/api (v1.0)\n";
  expect(parseSubmodulePaths(out, "/repo")).toEqual(["/repo/packages/api"]);
});

test("parseSubmodulePaths keeps +/U prefixed (initialized) entries", () => {
  const out = [
    "+2222222222222222222222222222222222222222 web (heads/feat)",
    "U3333333333333333333333333333333333333333 native",
  ].join("\n");
  expect(parseSubmodulePaths(out, "/repo")).toEqual(["/repo/web", "/repo/native"]);
});

test("parseSubmodulePaths skips uninitialized (-) entries", () => {
  const out = [
    "-4444444444444444444444444444444444444444 not-checked-out",
    " 5555555555555555555555555555555555555555 checked-out (v2)",
  ].join("\n");
  expect(parseSubmodulePaths(out, "/repo")).toEqual(["/repo/checked-out"]);
});

test("parseSubmodulePaths returns [] for no submodules", () => {
  expect(parseSubmodulePaths("", "/repo")).toEqual([]);
  expect(parseSubmodulePaths("\n\n", "/repo")).toEqual([]);
});
