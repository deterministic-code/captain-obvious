#!/usr/bin/env node
// Governance rule runner: block committing/pushing directly on a protected
// branch (main/master). The Claude PreToolUse variant lives in
// hooks/claude/main-branch-guard.sh; this is the git/CLI equivalent so the rule
// is runnable via defineRule().run (hooks/git/<slug>.mjs) and from bin/lint.mjs.
// Bypass for one invocation: ALLOW_EDIT_ON_MAIN=1.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { isInvokedAsScript } from "./lint-shared.mjs";

const execFileAsync = promisify(execFile);

const PROTECTED = new Set(["main", "master"]);

async function currentBranch(cwd) {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["symbolic-ref", "--short", "HEAD"],
      { cwd },
    );
    return stdout.trim();
  } catch {
    // Detached HEAD or not a repo — nothing to protect.
    return null;
  }
}

export async function main(argv, opts = {}) {
  const env = opts.env ?? process.env;
  const cwd = opts.cwd ?? process.cwd();
  if (env.ALLOW_EDIT_ON_MAIN === "1") {
    process.stdout.write(
      "gov-no-push-to-main: ALLOW_EDIT_ON_MAIN=1 accepted — allowing work on the protected branch.\n",
    );
    return;
  }
  const branch = await currentBranch(cwd);
  if (branch === null || !PROTECTED.has(branch)) {
    process.stdout.write(
      `gov-no-push-to-main: on '${branch ?? "detached HEAD"}' — not a protected branch.\n`,
    );
    return;
  }
  process.stderr.write(
    `BLOCKED: you are on protected branch '${branch}'. Never work off ${branch} directly — create a branch or worktree first (e.g. git worktree add -b <slug> .worktrees/<slug> ${branch}) and commit there. Bypass for one invocation: ALLOW_EDIT_ON_MAIN=1.\n`,
  );
  process.exit(1);
}

/* v8 ignore next 6 */
if (isInvokedAsScript(import.meta.url)) {
  main(process.argv).catch((err) => {
    process.stderr.write(`gov-no-push-to-main: ${err.message ?? err}\n`);
    process.exit(2);
  });
}
