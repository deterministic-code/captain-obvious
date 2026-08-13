import { chmod, mkdir, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { join, relative, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * The client-side git hooks the package installs. Each hook dispatches one of two
 * stages depending on who invoked git: `claude` when `CLAUDECODE=1` (git run by
 * Claude Code), `cli` otherwise (a human terminal). The stage slugs mirror the
 * canonical taxonomy in core/src/rules/stages.ts; `configKey` names the
 * gitHooks.<key> array whose `run:` passthroughs append to this hook. Only the
 * `hook` name is a real git hook filename — the `git-`prefixed cli slugs are not,
 * which is why slug and filename are separate here.
 */
const GIT_HOOKS = [
  { hook: "pre-commit", claude: "pre-commit", cli: "git-pre-commit", configKey: "preCommit" },
  { hook: "commit-msg", claude: "commit-msg", cli: "git-commit-msg", configKey: "commitMsg" },
  { hook: "pre-merge-commit", claude: "pre-merge-commit", cli: "git-pre-merge-commit", configKey: "preMergeCommit" },
  { hook: "pre-rebase", claude: "pre-rebase", cli: "git-pre-rebase", configKey: "preRebase" },
  { hook: "pre-push", claude: "pre-push", cli: "git-pre-push", configKey: "prePush" },
];

/**
 * Substring every installed hook carries (`relGitHooks` always ends in `hooks/git`),
 * so `list-hooks` can tell our scripts apart from foreign ones. The git-hooks contract
 * test pins that renderHook's output contains it.
 */
export const GIT_HOOK_MARKER = "hooks/git/dispatch.mjs";

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
 * One git-hook script. It picks the Claude-context stage when `CLAUDECODE=1` (git
 * invoked by Claude Code) and the CLI-context stage otherwise, then dispatches
 * that stage's enabled rule set (selection lives in the registry DB, so toggling a
 * rule in the control panel changes what runs with no reinstall), then any `run:`
 * passthroughs. `|| exit 1` fails the hook on a blocking rule or a failed
 * passthrough; advisory rules never exit non-zero. Passthroughs run in both
 * contexts — they are explicit repo commands, not context-split lint rules.
 */
export function renderHook(spec, relGitHooks, passthrough) {
  const lines = [
    `if [ "$CLAUDECODE" = "1" ]; then stage=${spec.claude}; else stage=${spec.cli}; fi`,
    `node "$ROOT/${relGitHooks}/dispatch.mjs" "$stage" || exit 1`,
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
 * Write every client-side git hook into the repo's git hooks dir, each dispatching
 * the enabled rules for its Claude- or CLI-context stage plus any `run:`
 * passthroughs. Returns the paths written. Returns [] when gitHooks.enabled === false.
 */
export async function installGitHooks({ target, pkgRoot, gitHooks }) {
  if (gitHooks?.enabled === false) {
    return [];
  }
  const relGitHooks = relative(target, join(pkgRoot, "hooks", "git"));
  const hooksDir = await gitHooksDir(target);
  await mkdir(hooksDir, { recursive: true });
  const written = [];
  for (const spec of GIT_HOOKS) {
    const file = join(hooksDir, spec.hook);
    await writeFile(
      file,
      renderHook(spec, relGitHooks, passthroughs(gitHooks[spec.configKey] ?? [])),
      "utf8",
    );
    await chmod(file, 0o755);
    written.push(file);
  }
  return written;
}
