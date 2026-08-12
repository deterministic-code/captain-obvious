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

async function promptAnswers(input, output) {
  let mode = "local";
  let wireGitHooks = true;
  let wireClaudeHooks = true;
  const rl = createInterface({ input, output });
  try {
    const modeAnswer = await rl.question(
      'Registry DB location — "local" (per-repo) or "global" (shared)? [local]: ',
    );
    if (modeAnswer.trim().toLowerCase() === "global") {
      mode = "global";
    }

    const gitAnswer = await rl.question(
      "Wire git pre-commit/pre-push hooks? [Y/n]: ",
    );
    if (gitAnswer.trim().toLowerCase().startsWith("n")) {
      wireGitHooks = false;
    }

    const claudeAnswer = await rl.question(
      "Wire Claude Code guard hooks (main-branch-guard, stop-unmerged-guard)? [Y/n]: ",
    );
    if (claudeAnswer.trim().toLowerCase().startsWith("n")) {
      wireClaudeHooks = false;
    }
  } finally {
    rl.close();
  }
  return { mode, wireGitHooks, wireClaudeHooks };
}

function buildConfig(mode, wireGitHooks, wireClaudeHooks) {
  const config = {};
  if (mode === "global") {
    config.mode = "global";
  }
  config.gitHooks = wireGitHooks ? {} : { enabled: false };
  if (wireClaudeHooks) {
    config.claudeHooks = [
      {
        event: "PreToolUse",
        matcher: "Edit|Write",
        hook: "main-branch-guard",
        timeout: 5,
      },
      { event: "Stop", hook: "stop-unmerged-guard", timeout: 15 },
    ];
  }
  return config;
}

/**
 * Scaffold captain-obvious.config.json at `target` if it doesn't exist.
 * Returns { path, created: boolean }. If `created` is false, the file already
 * existed and was not modified.
 *
 * When interactive (`isTTY` true) and config is missing, prompts for:
 * - Registry DB mode (local/global) [default: local]
 * - Wire git hooks? [default: yes]
 * - Wire Claude Code guard hooks? [default: yes]
 *
 * When non-interactive (`isTTY` false), uses these same defaults without prompting.
 */
export async function scaffoldConfig({
  target,
  input = process.stdin,
  output = process.stdout,
  isTTY = input.isTTY === true,
}) {
  const configPath = join(target, "captain-obvious.config.json");

  if (await fileExists(configPath)) {
    return { path: configPath, created: false };
  }

  let mode = "local";
  let wireGitHooks = true;
  let wireClaudeHooks = true;

  if (isTTY) {
    ({ mode, wireGitHooks, wireClaudeHooks } = await promptAnswers(
      input,
      output,
    ));
  }

  const config = buildConfig(mode, wireGitHooks, wireClaudeHooks);
  await writeJson(configPath, config);
  return { path: configPath, created: true };
}
