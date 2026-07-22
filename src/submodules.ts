import { join } from "node:path";

// Parse `git submodule status --recursive` output into work-tree paths,
// resolved against the superproject root. Each line is one submodule:
//
//   " <sha> <path> (<ref>)"   in sync
//   "+<sha> <path> (<ref>)"   checked out at a different commit
//   "U<sha> <path>"           merge conflicts
//   "-<sha> <path>"           not initialized (no work tree on disk)
//
// Uninitialized entries are skipped because there is nothing to inspect there.
export function parseSubmodulePaths(statusOutput: string, root: string): string[] {
  const paths: string[] = [];
  for (const line of statusOutput.split("\n")) {
    if (!line.trim() || line.startsWith("-")) continue;
    // After trimming the leading status char + whitespace, the path is the
    // second field (the first is the sha, possibly carrying a "+"/"U" prefix).
    const path = line.trim().split(/\s+/)[1];
    if (path) paths.push(join(root, path));
  }
  return paths;
}
