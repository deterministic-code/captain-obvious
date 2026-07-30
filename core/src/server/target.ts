/**
 * Resolve a Run/Fix target path into everything the rule hooks need: the
 * absolute path, whether it's a folder, the working directory to spawn in, and
 * the `--all` / `--files` mode args. Shared by run.ts (detection) and fix.ts
 * (remediation) so both scope a run identically.
 */
import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * The git repo root of the process's working directory — the one anchor every
 * rule agrees on. Whole-repo tools (knip, jscpd) already report paths relative
 * to it; scoping runs here makes the file-scoped rules do the same, so the Run
 * panel can resolve any violation's path against a single base.
 */
export async function repoRoot(): Promise<string> {
  const { stdout } = await execFileAsync("git", ["rev-parse", "--show-toplevel"]);
  return stdout.trim();
}

/** Throw a clean 400-worthy error unless `path` is inside a git work tree (the `--all` hooks need `git ls-files`). */
async function assertGitRepo(path: string): Promise<void> {
  await execFileAsync("git", [
    "-C",
    path,
    "rev-parse",
    "--is-inside-work-tree",
  ]).catch(() => {
    throw new Error(`not a git repository (or missing folder): ${path}`);
  });
}

export interface RunTarget {
  /** Absolute target path (a folder or a single file). */
  target: string;
  isDir: boolean;
  /** Working directory to spawn hooks in — the folder itself, or a file's parent. */
  cwd: string;
  /** A folder scans its whole tree (`--all`); a file scans just itself (`--files <path>`). */
  modeArgs: string[];
}

/**
 * Resolve `rawPath` (default: the repo root) to a `RunTarget`. A relative path is
 * resolved against the repo root, not the process cwd — the panel deals in
 * root-relative violation paths, and `serve` may run from a subdirectory (e.g.
 * `core/`), so cwd-relative resolution would point at a phantom file. Throws if
 * the target doesn't exist or isn't inside a git work tree.
 */
export async function resolveRunTarget(rawPath?: string): Promise<RunTarget> {
  const root = await repoRoot();
  const target = rawPath?.trim() ? resolve(root, rawPath.trim()) : root;
  const info = await stat(target).catch(() => {
    throw new Error(`no such file or folder: ${target}`);
  });
  const isDir = info.isDirectory();
  const cwd = isDir ? target : dirname(target);
  await assertGitRepo(cwd);
  const modeArgs = isDir ? ["--all"] : ["--files", target];
  return { target, isDir, cwd, modeArgs };
}
