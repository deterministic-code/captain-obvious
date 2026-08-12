import { chmod, mkdir, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { join, relative, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** The git stages the package installs; each dispatches its enabled rule set. */
const STAGES = [
  ["pre-commit", "preCommit"],
  ["pre-push", "prePush"],
];

/**
 * `run: <cmd>` entries are arbitrary shell passthroughs (e.g. test tiers). Rule
 * entries are ignored here — the dispatcher selects the enabled rules from the
 * registry DB, so the config no longer decides which rules run.
 */
function passthroughs(entries) {
  return entries
    .map((entry) => entry.trim())
    .filter((entry) => entry.startsWith("run:"))
    .map((entry) => entry.slice("run:".length).trim());
}

/**
 * One git-hook script: dispatch the stage's enabled rule set (selection lives in
 * the registry DB, so toggling a rule in the control panel changes what runs with
 * no reinstall), then any `run:` passthroughs. `|| exit 1` fails the hook on a
 * blocking rule or a failed passthrough; advisory rules never exit non-zero.
 */
export function renderHook(stage, relGitHooks, passthrough) {
  const lines = [
    `node "$ROOT/${relGitHooks}/dispatch.mjs" ${stage} || exit 1`,
    ...passthrough.map((cmd) => `${cmd} || exit 1`),
  ];
  return `#!/bin/sh\nROOT="$(git rev-parse --show-toplevel)"\n${lines.join("\n")}\n`;
}

async function gitHooksDir(target) {
  const { stdout } = await execFileAsync(
    "git",
    ["rev-parse", "--git-path", "hooks"],
    {
      cwd: target,
      encoding: "utf8",
    },
  );
  // Linked worktrees return absolute --git-path: resolve it, don't join onto target.
  return resolve(target, stdout.trim());
}

/**
 * Write `pre-commit` and `pre-push` into the repo's git hooks dir, each dispatching
 * the enabled rules for its stage plus any `run:` passthroughs. Returns the paths written.
 * Returns [] when gitHooks.enabled === false.
 */
export async function installGitHooks({ target, pkgRoot, gitHooks }) {
  if (gitHooks?.enabled === false) {
    return [];
  }
  const relGitHooks = relative(target, join(pkgRoot, "hooks", "git"));
  const hooksDir = await gitHooksDir(target);
  await mkdir(hooksDir, { recursive: true });
  const written = [];
  for (const [stage, key] of STAGES) {
    const file = join(hooksDir, stage);
    await writeFile(
      file,
      renderHook(stage, relGitHooks, passthroughs(gitHooks[key] ?? [])),
      "utf8",
    );
    await chmod(file, 0o755);
    written.push(file);
  }
  return written;
}
