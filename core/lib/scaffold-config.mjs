import { access } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { writeJson } from "./json-file.mjs";

async function fileExists(p) {
  return access(p).then(
    () => true,
    () => false,
  );
}

// Prompts only for values the caller didn't pin via `overrides`, mutating `resolved` in place.
async function promptMissing(input, output, resolved, overrides) {
  const rl = createInterface({ input, output });
  try {
    if (overrides.mode === undefined) {
      const answer = await rl.question(
        'Registry DB location — "local" (per-repo) or "global" (shared)? [local]: ',
      );
      if (answer.trim().toLowerCase() === "global") {
        resolved.mode = "global";
      }
    }
    if (overrides.wireHooks === undefined) {
      const answer = await rl.question(
        "Wire git + Claude Code guard hooks? [Y/n]: ",
      );
      if (answer.trim().toLowerCase().startsWith("n")) {
        resolved.wireHooks = false;
      }
    }
    // Only local mode keeps DBs inside the repo, so it's the only mode worth ignoring.
    if (resolved.mode === "local" && overrides.gitignore === undefined) {
      const answer = await rl.question(
        "Add .captain-obvious/ to .gitignore? [Y/n]: ",
      );
      if (answer.trim().toLowerCase().startsWith("n")) {
        resolved.gitignore = false;
      }
    }
  } finally {
    rl.close();
  }
}

function buildConfig({ mode, wireHooks, gitignore }) {
  const config = {};
  if (mode === "global") {
    config.mode = "global";
  } else {
    config.gitignore = gitignore;
  }
  config.gitHooks = wireHooks ? {} : { enabled: false };
  if (wireHooks) {
    config.claudeHooks = [
      {
        event: "PreToolUse",
        matcher: "Edit|Write|NotebookEdit|Bash",
        hook: "pre-tool-guard",
        timeout: 5,
      },
      { event: "Stop", hook: "stop-guard", timeout: 15 },
    ];
  }
  return config;
}

/**
 * Scaffold captain-obvious.config.json at `target` if it doesn't exist.
 * Returns { path, created: boolean }. If `created` is false, the file already
 * existed and was not modified.
 *
 * When interactive (`isTTY` true and `yes` false), prompts for anything not
 * pinned via `defaults`:
 * - Registry DB mode (local/global) [default: local]
 * - Wire git + Claude Code guard hooks? [default: yes]
 * - Add .captain-obvious/ to .gitignore? [default: yes] (local mode only)
 *
 * `yes` (or a non-TTY stdin) skips all prompts and takes the defaults. `defaults`
 * ({ mode, wireHooks, gitignore }) pins individual answers from CLI flags — a pinned
 * value is never prompted for, so `--mode global` still asks about hooks but not mode.
 */
export async function scaffoldConfig({
  target,
  input = process.stdin,
  output = process.stdout,
  isTTY = input.isTTY === true,
  yes = false,
  defaults = {},
}) {
  const configPath = join(target, "captain-obvious.config.json");

  if (await fileExists(configPath)) {
    return { path: configPath, created: false };
  }

  const overrides = {
    mode: defaults.mode,
    wireHooks: defaults.wireHooks,
    gitignore: defaults.gitignore,
  };
  const resolved = {
    mode: overrides.mode ?? "local",
    wireHooks: overrides.wireHooks ?? true,
    gitignore: overrides.gitignore ?? true,
  };

  if (isTTY && !yes) {
    await promptMissing(input, output, resolved, overrides);
  }

  await writeJson(configPath, buildConfig(resolved));
  return { path: configPath, created: true };
}
