import { execFile, spawn, type ChildProcess } from "node:child_process";
import { realpathSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { installClaudeHooks } from "../core/lib/claude-settings.mjs";
import { installGitHooks } from "../core/lib/git-hooks.mjs";

const execFileAsync = promisify(execFile);

const HERE = dirname(fileURLToPath(import.meta.url));
/** captain-obvious repo root — the pkgRoot base the installed hooks point back at. */
export const REPO_ROOT = dirname(HERE);
export const CORE_ROOT = join(REPO_ROOT, "core");
export const CLI = join(CORE_ROOT, "dist", "bin", "captain-obvious.js");

/**
 * A throwaway repo + DBs under the OS temp dir, rebuilt from scratch each run.
 * `realpathSync` canonicalises the base (on macOS `os.tmpdir()` is the `/var`
 * symlink but `git rev-parse --show-toplevel` and Claude's `CLAUDE_PROJECT_DIR`
 * report the resolved `/private/var` path) so the relative hook paths the
 * installers bake in match what git/Claude resolve at runtime.
 */
export const SANDBOX = join(realpathSync(tmpdir()), "co-e2e-hooks");
export const REPO_DIR = join(SANDBOX, "repo");
export const REMOTE_DIR = join(SANDBOX, "remote.git");
export const DB_PATH = join(REPO_DIR, ".captain-obvious", "registry.db");
export const AUDIT_DB_PATH = join(REPO_DIR, ".captain-obvious", "audit.db");

export const SERVE_PORT = 4319;
export const BASE_URL = `http://127.0.0.1:${SERVE_PORT}`;

/** The env every hook and the server share so they all resolve the sandbox DBs. */
export const dbEnv = {
  CAPTAIN_OBVIOUS_DB: DB_PATH,
  CAPTAIN_OBVIOUS_AUDIT_DB: AUDIT_DB_PATH,
};

/**
 * Governance rules that can't run in an offline scratch repo: the two GitHub ones
 * (branch-protection / CI status) and gov-tests-green (spawns the repo's `npm test`,
 * which a fixture repo has no package.json for). Disabled in the seeded registry so
 * they neither fire nor appear in the feed.
 */
export const DISABLED_RULES = [
  "gov-require-pr",
  "gov-main-ci-green",
  "gov-tests-green",
];

/** The two Claude guard hooks, wired the same way `captain-obvious-install` does. */
const CLAUDE_HOOKS = [
  {
    event: "PreToolUse",
    matcher: "Edit|Write|NotebookEdit|Bash",
    hook: "pre-tool-guard",
    timeout: 10,
  },
  { event: "Stop", hook: "stop-guard", timeout: 20 },
];

function git(args: string[], extraEnv: Record<string, string> = {}) {
  return execFileAsync("git", args, {
    cwd: REPO_DIR,
    env: { ...process.env, ...extraEnv },
  });
}

function cli(args: string[]) {
  return execFileAsync("node", [CLI, ...args], {
    cwd: REPO_ROOT,
    env: { ...process.env, ...dbEnv },
  });
}

/**
 * Create the throwaway repo, seed the registry from the discovered rules, disable
 * the offline-incompatible governance rules, and attach the real hooks
 * (`.git/hooks/*` + `.claude/settings.json`) pointing back at `core`. Leaves the
 * repo on a `feature` branch with one uncommitted file so the Stop guard blocks.
 */
export async function buildSandbox(): Promise<void> {
  await rm(SANDBOX, { recursive: true, force: true });
  await mkdir(join(REPO_DIR, ".captain-obvious"), { recursive: true });
  await mkdir(join(REPO_DIR, "src"), { recursive: true });

  await git(["init", "-q", "-b", "main"]);
  await git(["config", "user.email", "e2e@test.co"]);
  await git(["config", "user.name", "co-e2e"]);
  await writeFile(join(REPO_DIR, "src", "a.ts"), 'export const a = "hello";\n');
  await git(["add", "-A"]);
  await git(["commit", "-qm", "init"]);
  await git(["checkout", "-q", "-b", "feature"]);
  await writeFile(join(REPO_DIR, "src", "b.ts"), 'export const b = "unmerged";\n');

  await cli(["seed-rules"]);
  for (const slug of DISABLED_RULES) await cli(["configure-rule", slug, "--disable"]);

  await installGitHooks({ target: REPO_DIR, pkgRoot: CORE_ROOT, gitHooks: {} });
  await installClaudeHooks({
    target: REPO_DIR,
    pkgRoot: CORE_ROOT,
    claudeHooks: CLAUDE_HOOKS,
  });

  await execFileAsync("git", ["init", "-q", "--bare", REMOTE_DIR]);
  await git(["remote", "add", "origin", REMOTE_DIR]);
}

/**
 * Run a command whose non-zero exit is expected and irrelevant: a git hook is
 * designed to abort the commit/push on a halting rule, but it has already written
 * its audit rows by then — those rows, not the command's exit code, are what we
 * assert on. Resolves regardless so the fixture captures the trail either way.
 */
function runCapturingExit(
  cmd: string,
  args: string[],
  env: Record<string, string>,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: REPO_DIR,
      env: { ...process.env, ...env },
      stdio: "ignore",
    });
    // Any exit code resolves (a hook abort is expected); only a failure to spawn
    // the process at all is a real error worth surfacing.
    child.on("close", () => resolve());
    child.on("error", reject);
  });
}

/**
 * Fire the git hooks the way Claude Code drives them (`CLAUDECODE=1`, which selects
 * the `pre-commit`/`pre-push` stages the rules are registered on — the plain-CLI
 * `git-pre-commit`/`git-pre-push` stages carry no rules). One commit fires
 * pre-commit dispatch; the push to the bare remote fires pre-push dispatch.
 */
export async function fireGitHooks(): Promise<void> {
  const claudeCtx = { ...dbEnv, CLAUDECODE: "1" };
  await writeFile(
    join(REPO_DIR, "src", "greeting.ts"),
    'export const greeting = "hi";\n',
  );
  await git(["add", "-A"]);
  await runCapturingExit("git", ["commit", "-m", "trigger pre-commit"], claudeCtx);
  await runCapturingExit("git", ["push", "-u", "origin", "feature"], claudeCtx);
}

/**
 * Fire the two Claude hooks with a real headless `claude -p` session. Bash is
 * disallowed so Claude can't run git/gh — that keeps the run offline and stops it
 * from merging away the unmerged work, so the Stop guard blocks deterministically.
 * A single Write triggers PreToolUse (both tool guards log); the session end
 * triggers Stop (the stop guard logs).
 */
export async function fireClaudeHooks(): Promise<void> {
  await assertClaudeAvailable();
  const args = [
    "-p",
    "--output-format",
    "stream-json",
    "--verbose",
    "--disallowedTools",
    "Bash",
    "--settings",
    join(REPO_DIR, ".claude", "settings.json"),
  ];
  const prompt =
    "Use the Write tool to create a file at src/from-claude.ts containing exactly: " +
    "export const fromClaude = 1; Do not run any other tool. Do not explain.";
  await new Promise<void>((resolve, reject) => {
    const child = spawn("claude", args, {
      cwd: REPO_DIR,
      env: { ...process.env, ...dbEnv },
      stdio: ["pipe", "ignore", "ignore"],
    });
    child.stdin.end(prompt);
    child.on("close", () => resolve());
    child.on("error", reject);
  });
}

async function assertClaudeAvailable(): Promise<void> {
  await execFileAsync("claude", ["--version"]).catch(() => {
    throw new Error(
      "`claude` CLI not found on PATH — the PreToolUse/Stop legs drive a real " +
        "headless `claude -p`. Install + authenticate Claude Code (see e2e/README.md).",
    );
  });
}

/** Start `captain-obvious serve` against the sandbox DBs and wait until it answers. */
export async function startServe(): Promise<ChildProcess> {
  const child = spawn(
    "node",
    [CLI, "serve", "--port", String(SERVE_PORT), "--host", "127.0.0.1"],
    { cwd: REPO_ROOT, env: { ...process.env, ...dbEnv }, stdio: "ignore" },
  );
  for (let i = 0; i < 50; i++) {
    const ok = await fetch(`${BASE_URL}/api/mode`).then(
      (r) => r.ok,
      () => false,
    );
    if (ok) return child;
    await new Promise((r) => setTimeout(r, 200));
  }
  child.kill();
  throw new Error(`serve did not come up on ${BASE_URL} within 10s`);
}
