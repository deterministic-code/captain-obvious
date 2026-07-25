import { chmod, mkdir, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { join, relative } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** A `--warn` entry is advisory: its findings print but never fail the hook. */
function isAdvisory(entry) {
  return entry.includes("--warn");
}

/**
 * Translate a config entry into one shell line. `run: <cmd>` passes through verbatim;
 * anything else is `<stem> <args>` resolved to the package's `hooks/git/<stem>.mjs`.
 */
function toLine(entry, relGitHooks) {
  const trimmed = entry.trim();
  const command = trimmed.startsWith("run:")
    ? trimmed.slice("run:".length).trim()
    : buildNodeCall(trimmed, relGitHooks);
  return isAdvisory(entry) ? command : `${command} || exit 1`;
}

function buildNodeCall(entry, relGitHooks) {
  const [stem, ...args] = entry.split(/\s+/);
  const script = `"$ROOT/${relGitHooks}/${stem}.mjs"`;
  return ["node", script, ...args].join(" ");
}

function renderScript(entries, relGitHooks) {
  const lines = entries.map((entry) => toLine(entry, relGitHooks));
  return `#!/bin/sh\nROOT="$(git rev-parse --show-toplevel)"\n${lines.join("\n")}\n`;
}

async function gitHooksDir(target) {
  const { stdout } = await execFileAsync("git", ["rev-parse", "--git-path", "hooks"], {
    cwd: target,
    encoding: "utf8",
  });
  return join(target, stdout.trim());
}

/**
 * Write `pre-commit` and `pre-push` into the repo's git hooks dir, each invoking the
 * package's lint hooks from their installed location. Returns the paths written.
 */
export async function installGitHooks({ target, pkgRoot, gitHooks }) {
  const relGitHooks = relative(target, join(pkgRoot, "hooks", "git"));
  const hooksDir = await gitHooksDir(target);
  await mkdir(hooksDir, { recursive: true });
  const written = [];
  for (const [name, entries] of [
    ["pre-commit", gitHooks.preCommit ?? []],
    ["pre-push", gitHooks.prePush ?? []],
  ]) {
    if (entries.length === 0) {
      continue;
    }
    const target_ = join(hooksDir, name);
    await writeFile(target_, renderScript(entries, relGitHooks), "utf8");
    await chmod(target_, 0o755);
    written.push(target_);
  }
  return written;
}
