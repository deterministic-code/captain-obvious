import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { vi } from "vitest";

const execFileAsync = promisify(execFile);

/** Recursively remove a temp dir, tolerating Windows/AV retry races. */
export async function cleanupTmp(root) {
  await rm(root, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 50,
  });
}

/** Deterministic git identity so commits in tests don't depend on the host's git config. */
const GIT_TEST_ENV = {
  ...Object.fromEntries(
    Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_")),
  ),
  GIT_AUTHOR_NAME: "t",
  GIT_AUTHOR_EMAIL: "t@t",
  GIT_COMMITTER_NAME: "t",
  GIT_COMMITTER_EMAIL: "t@t",
};

export async function gitIn(repo, args) {
  return execFileAsync("git", args, {
    cwd: repo,
    encoding: "utf8",
    env: GIT_TEST_ENV,
  });
}

export async function makeTempGitRepo(prefix) {
  const repo = await mkdtemp(join(tmpdir(), prefix));
  await gitIn(repo, ["init", "-q"]);
  await gitIn(repo, ["checkout", "-q", "-b", "main"]);
  return repo;
}

export async function commitAllIn(repo, message) {
  await gitIn(repo, ["add", "-A"]);
  await gitIn(repo, ["commit", "-q", "-m", message]);
}

export async function markCurrentAsOriginMain(repo) {
  const { stdout } = await gitIn(repo, ["rev-parse", "HEAD"]);
  await gitIn(repo, ["update-ref", "refs/remotes/origin/main", stdout.trim()]);
}

export async function runHookPush(scriptPath, repo, args = ["--push"]) {
  try {
    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      [scriptPath, ...args],
      {
        cwd: repo,
        encoding: "utf8",
        env: GIT_TEST_ENV,
        maxBuffer: 64 * 1024 * 1024,
      },
    );
    return { code: 0, stdout, stderr };
  } catch (err) {
    return {
      code: err.code ?? 1,
      stdout: err.stdout ?? "",
      stderr: err.stderr ?? "",
    };
  }
}

/** Spy process.exit (throwing `__exit__:<code>`), stderr.write, and stdout.write for hook-main tests. */
export function mockProcessIo() {
  const exitSpy = vi.spyOn(process, "exit").mockImplementation((code) => {
    throw new Error(`__exit__:${code}`);
  });
  const stderrSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true);
  const stdoutSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);
  return {
    exitSpy,
    stderrSpy,
    stdoutSpy,
    text: (spy) => spy.mock.calls.map((c) => c[0]).join(""),
    restore() {
      exitSpy.mockRestore();
      stderrSpy.mockRestore();
      stdoutSpy.mockRestore();
    },
  };
}
