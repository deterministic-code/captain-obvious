import { execFile, spawn, type ChildProcess } from "node:child_process";
import { mkdir, realpath, rm, writeFile } from "node:fs/promises";
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

/** A throwaway repo + DBs under the OS temp dir, rebuilt from scratch each run. */
export const SANDBOX = join(tmpdir(), "co-e2e-hooks");
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
 * Rules disabled in the sandbox registry. The governance three can't run offline
 * (GitHub branch-protection / CI status, and gov-tests-green spawns the repo's
 * `npm test`, which a fixture repo has no package.json for). The last two are
 * halting rules unrelated to this exercise that would otherwise abort the commit
 * before the duplicated files reach HEAD — where pre-push's dup ratchet needs them.
 * All disabled ones are asserted never to run.
 */
export const DISABLED_RULES = [
  "gov-require-pr",
  "gov-main-ci-green",
  "gov-tests-green",
  "lint-dead-code",
  "lint-tests-with-code",
];

/**
 * The Claude hooks, wired the same way `captain-obvious-install` does. PostToolUse
 * `tool-fix` is what runs Prettier --write on every file Claude writes (and logs
 * it) — the "a lint tool runs each time Claude writes a file" path this exercise
 * demonstrates; PreToolUse guards + the Stop guard round out the four hook events.
 */
const CLAUDE_HOOKS = [
  {
    event: "PreToolUse",
    matcher: "Edit|Write|NotebookEdit|Bash",
    hook: "pre-tool-guard",
    timeout: 10,
  },
  {
    event: "PostToolUse",
    matcher: "Edit|Write|NotebookEdit",
    hook: "tool-fix",
    timeout: 20,
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
  // Keep the binary registry/audit DBs out of `git add -A` so commits stay to src.
  await writeFile(join(REPO_DIR, ".gitignore"), ".captain-obvious/\n");
  await writeFile(join(REPO_DIR, "src", "a.ts"), 'export const a = "hello";\n');
  await git(["add", "-A"]);
  await git(["commit", "-qm", "init"]);

  // Seed origin/main as the dup ratchet's baseline before the hooks exist (fires nothing).
  await execFileAsync("git", ["init", "-q", "--bare", REMOTE_DIR]);
  await git(["remote", "add", "origin", REMOTE_DIR]);
  await git(["push", "-q", "origin", "main"]);

  await git(["checkout", "-q", "-b", "feature"]);
  await writeFile(
    join(REPO_DIR, "src", "b.ts"),
    'export const b = "unmerged";\n',
  );

  await seedRegistry();

  // target must be the canonical path git/Claude resolve at runtime (macOS /var → /private/var).
  const target = await realpath(REPO_DIR);
  await installGitHooks({ target, pkgRoot: CORE_ROOT, gitHooks: {} });
  await installClaudeHooks({
    target,
    pkgRoot: CORE_ROOT,
    claudeHooks: CLAUDE_HOOKS,
  });
}

/** Seed the registry from the discovered rules, then disable the offline-incompatible ones. */
async function seedRegistry(): Promise<void> {
  await cli(["seed-rules"]);
  for (const slug of DISABLED_RULES) {
    await cli(["configure-rule", slug, "--disable"]);
  }
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
    // Any exit code resolves (a hook abort is expected); only a spawn failure rejects.
    child.on("close", () => resolve());
    child.on("error", reject);
  });
}

/**
 * Fire the git hooks the way Claude Code drives them (`CLAUDECODE=1`, which selects
 * the `pre-commit`/`pre-push` stages the rules are registered on — the plain-CLI
 * `git-pre-commit`/`git-pre-push` stages carry no rules). Stages everything Claude
 * just wrote, commits (fires pre-commit: Prettier check + friends), and pushes to
 * the bare remote (fires pre-push: the dup ratchet flags the duplicated functions).
 */
export async function fireGitHooks(): Promise<void> {
  const claudeCtx = { ...dbEnv, CLAUDECODE: "1" };
  await git(["add", "-A"]);
  await runCapturingExit(
    "git",
    ["commit", "-m", "commit claude's files"],
    claudeCtx,
  );
  await runCapturingExit("git", ["push", "-u", "origin", "feature"], claudeCtx);
}

/**
 * The messy, duplicated function Claude writes into two files. Its formatting
 * (single quotes, missing semicolons, tight spacing) is what PostToolUse Prettier
 * rewrites on each write; its identical body across two files is what pre-push's
 * dup ratchet flags. Kept deliberately non-trivial so it clears the clone-size floor.
 */
const DUP_FN =
  "export function summarize(rows) {\n" +
  "let total = 0\n" +
  "let count = 0\n" +
  "for (const r of rows) {\n" +
  "total = total + r.amount * r.quantity\n" +
  "count = count + 1\n" +
  "}\n" +
  "const average = count === 0 ? 0 : total / count\n" +
  "const label = 'grand total = ' + total + ' over ' + count + ' rows'\n" +
  "const summary = { total: total, count: count, average: average, label: label }\n" +
  "return summary\n" +
  "}\n";

/**
 * Fire the Claude hooks with a real headless `claude -p` session. Bash is
 * disallowed so Claude can't run git/gh — that keeps the run offline and stops it
 * from merging away the unmerged work, so the Stop guard blocks deterministically.
 * Each Write triggers PreToolUse (the tool guards log) and PostToolUse (Prettier
 * reformats the messy file and logs it); the session end triggers Stop. Writing the
 * same function into two files seeds the duplication pre-push then flags.
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
    "Create two files with the Write tool, each containing EXACTLY the text " +
    "between the markers verbatim — do not reformat it, do not fix it, do not add " +
    "or remove anything. Do not run any other tool. Do not explain.\n\n" +
    `--- write this into src/orders.ts ---\n${DUP_FN}\n` +
    `--- write this into src/billing.ts ---\n${DUP_FN}`;
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
