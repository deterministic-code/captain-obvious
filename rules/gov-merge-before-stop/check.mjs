#!/usr/bin/env node
// Governance rule runner: block ending a Claude session (the Stop hook) while
// work is unmerged. Ported from the former hooks/claude/stop-unmerged-guard.sh so
// the rule is a first-class member of the registry and runs through the single
// rule runner (logged like every other rule). Writes the block reason to stderr
// and exits 1 to block; exits 0 to allow.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { isInvokedAsScript } from "@deterministic-code/co-rule-kit/lint-shared";

const execFileAsync = promisify(execFile);

/** git plumbing in `cwd`; trimmed stdout, or null when the command fails. */
async function git(cwd, args) {
  return execFileAsync("git", ["-C", cwd, ...args]).then(
    ({ stdout }) => stdout.trim(),
    () => null,
  );
}

/**
 * The open PR for `branch`: an object when one exists, null when none, or
 * `undefined` when gh is unavailable (so the caller can skip PR-based checks
 * exactly as the shell guard did behind `command -v gh`).
 */
async function openPr(cwd, branch) {
  const hasGh = await execFileAsync("gh", ["--version"]).then(
    () => true,
    () => false,
  );
  if (!hasGh) return undefined;
  const out = await execFileAsync(
    "gh",
    ["pr", "list", "--head", branch, "--state", "open", "--json", "number,isDraft", "--limit", "1"],
    { cwd },
  ).then(
    ({ stdout }) => stdout.trim(),
    () => "[]",
  );
  const list = JSON.parse(out || "[]");
  return list[0] ?? null;
}

/** The reason stopping should be blocked on this branch, or null to allow. */
export async function stopBlockReason(cwd, opts = {}) {
  const protectedBranches = opts.branches ?? ["main", "master"];
  const inside = await git(cwd, ["rev-parse", "--is-inside-work-tree"]);
  if (inside !== "true") return null;
  const branch = await git(cwd, ["symbolic-ref", "--short", "HEAD"]);
  // On a protected branch there is nothing to merge — allow (matches the guard).
  if (!branch || protectedBranches.includes(branch)) return null;

  if (await git(cwd, ["status", "--porcelain"])) {
    return `Stop blocked: uncommitted changes on branch '${branch}'. Commit them (git add + git commit), push, open a PR, and merge before stopping.`;
  }

  const upstream = await git(cwd, ["rev-parse", "--abbrev-ref", "@{u}"]);
  if (upstream) {
    const ahead = await git(cwd, ["rev-list", "--count", "@{u}..HEAD"]);
    if (ahead && ahead !== "0") {
      return `Stop blocked: branch '${branch}' has ${ahead} local commit(s) ahead of remote. Push them (git push), then PR + merge.`;
    }
  }

  const pr = await openPr(cwd, branch);
  if (pr === undefined) return null;
  if (pr && !pr.isDraft) {
    return `Stop blocked: open non-draft PR #${pr.number} for branch '${branch}'. Merge it: gh pr merge ${pr.number} --squash --delete-branch.`;
  }
  if (pr === null) {
    const extra = await git(cwd, ["rev-list", "--count", `main..${branch}`]);
    if (extra && extra !== "0") {
      return `Stop blocked: branch '${branch}' has ${extra} commit(s) not on main and no open PR. Open one (gh pr create), then merge.`;
    }
  }
  return null;
}

export async function main(argv, opts = {}) {
  const cwd = opts.cwd ?? process.cwd();
  const reason = await stopBlockReason(cwd, opts);
  if (reason) {
    process.stderr.write(`${reason}\n`);
    process.exit(1);
  }
}

/* v8 ignore next 6 */
if (isInvokedAsScript(import.meta.url)) {
  main(process.argv).catch((err) => {
    process.stderr.write(`gov-merge-before-stop: ${err.message ?? err}\n`);
    process.exit(2);
  });
}
