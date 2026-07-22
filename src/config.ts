import { join } from "node:path";

// When to prefix the label with the PR's repository name:
//   never     — never show it (label is just "#123 ✓")
//   submodule — only when the PR was found in a submodule, i.e. a different
//               repo than the pane's own (the useful case: "which repo?")
//   always    — always show it, even for the pane's own repo
export type RepoNameMode = "never" | "submodule" | "always";

// short — repo name only ("workspace"); full — "owner/name".
export type RepoNameFormat = "short" | "full";

export interface Config {
  repoName: {
    mode: RepoNameMode;
    format: RepoNameFormat;
  };
}

export const DEFAULT_CONFIG: Config = {
  repoName: { mode: "submodule", format: "short" },
};

const MODES: readonly RepoNameMode[] = ["never", "submodule", "always"];
const FORMATS: readonly RepoNameFormat[] = ["short", "full"];

// Normalize an arbitrary parsed object into a Config, keeping the default for
// any missing or invalid field. Pure so it can be unit tested without touching
// the filesystem.
export function parseConfig(raw: unknown): Config {
  const root = isRecord(raw) ? raw : {};
  const repoName = isRecord(root.repoName) ? root.repoName : {};
  return {
    repoName: {
      mode: MODES.includes(repoName.mode as RepoNameMode)
        ? (repoName.mode as RepoNameMode)
        : DEFAULT_CONFIG.repoName.mode,
      format: FORMATS.includes(repoName.format as RepoNameFormat)
        ? (repoName.format as RepoNameFormat)
        : DEFAULT_CONFIG.repoName.format,
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Load config.json from the plugin's config dir (HERDR_PLUGIN_CONFIG_DIR, set
// by herdr; `herdr plugin config-dir gh-pr` prints it). Missing or malformed
// config falls back to defaults — the plugin must never fail on a bad config.
export async function loadConfig(): Promise<Config> {
  const dir = process.env.HERDR_PLUGIN_CONFIG_DIR;
  if (!dir) return DEFAULT_CONFIG;
  try {
    const file = Bun.file(join(dir, "config.json"));
    if (!(await file.exists())) return DEFAULT_CONFIG;
    return parseConfig(await file.json());
  } catch {
    return DEFAULT_CONFIG;
  }
}
