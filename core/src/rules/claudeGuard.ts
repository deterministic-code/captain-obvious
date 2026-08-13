import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import { dirname, join, normalize, relative } from "node:path";
import { promisify } from "node:util";
import { getDefaultProjectProtected } from "../db/projects.js";
import type { Db } from "../db/open.js";
import { selectDispatch } from "./dispatch.js";
import { matchProtected } from "./protectedPaths.js";
import { dispatch, type GuardVerdict } from "./runner.js";

const execFileAsync = promisify(execFile);

/** Claude Code PreToolUse tools that carry a `file_path` we can guard. */
const EDIT_TOOLS = new Set(["Edit", "Write", "NotebookEdit"]);
const DEFAULT_BRANCHES = ["main", "master"];
/** git mutations denied on a protected branch (mirrors main-branch-guard.sh). */
const FORBIDDEN_GIT = /^git\s+(commit|add|stash|rebase|reset|checkout\s+--)/;

const ALLOW: GuardVerdict = { deny: false };

// ---------------------------------------------------------------------------
// lint-protected-paths — deny editing a path matching the project's globs.
// ---------------------------------------------------------------------------

/**
 * Decide whether a PreToolUse event touches a protected path. `inputJson` is the
 * raw hook stdin; `repoRoot` is the git top-level the edited path is relative to.
 * Fail-open on tools/inputs we don't guard; deny only a concrete in-repo file
 * that matches a protected glob.
 */
export function evaluateGuard(
  inputJson: string,
  repoRoot: string,
  globs: string[],
): GuardVerdict {
  const input = JSON.parse(inputJson) as {
    tool_name?: string;
    tool_input?: { file_path?: string };
  };
  if (!input.tool_name || !EDIT_TOOLS.has(input.tool_name)) return ALLOW;
  const filePath = input.tool_input?.file_path;
  if (!filePath) return ALLOW;
  const rel = relative(repoRoot, filePath);
  if (!rel || rel.startsWith("..")) return ALLOW;
  if (!matchProtected(rel, globs)) return ALLOW;
  return {
    deny: true,
    reason: `BLOCKED: ${rel} is a protected path (captain-obvious project settings). Unprotect it in the control panel to edit, or edit a different file.`,
  };
}

// ---------------------------------------------------------------------------
// gov-no-push-to-main — deny edits / dangerous git commands on a protected branch.
// (The tool-stage half of the rule; its git/CLI half is rules/.../check.mjs.)
// ---------------------------------------------------------------------------

/**
 * The cwd of the first forbidden `git` mutation in a Bash command, or null when
 * the command runs no guarded git operation. Follows `cd` and `git -C` across a
 * `&&`/`;`/`||`-chained command so the branch is resolved where the git op runs.
 */
export function forbiddenGitDir(command: string, cwd: string): string | null {
  let dir = cwd;
  for (const raw of command.split(/\s*(?:&&|\|\||;|\n)\s*/)) {
    let stmt = raw.trim();
    if (!stmt) continue;
    const cd = stmt.match(/^cd\s+(\S+)/);
    if (cd) {
      const target = cd[1].replace(/^['"]|['"]$/g, "");
      dir = target.startsWith("/") ? target : normalize(join(dir, target));
      continue;
    }
    const gitC = stmt.match(/^git\s+-C\s+(\S+)\s+(.*)/);
    if (gitC) {
      const target = gitC[1].replace(/^['"]|['"]$/g, "");
      dir = target.startsWith("/") ? target : normalize(join(dir, target));
      stmt = `git ${gitC[2]}`;
    }
    if (FORBIDDEN_GIT.test(stmt)) return dir;
  }
  return null;
}

/** The current branch of the repo containing `dir`, or null (detached / not a repo). */
async function branchOf(dir: string): Promise<string | null> {
  return execFileAsync("git", [
    "-C",
    dir,
    "symbolic-ref",
    "--short",
    "HEAD",
  ]).then(
    ({ stdout }) => stdout.trim(),
    () => null,
  );
}

async function dirExists(dir: string): Promise<boolean> {
  return access(dir).then(
    () => true,
    () => false,
  );
}

/**
 * Deny a PreToolUse edit, or a git-mutating Bash command, that lands on a
 * protected branch. `cwd` is the fallback working dir for a Bash command with no
 * explicit `cwd`. Bypass for one call: `ALLOW_EDIT_ON_MAIN=1`.
 */
export async function evaluateMainBranch(
  inputJson: string,
  cwd: string,
  branches: string[] = DEFAULT_BRANCHES,
  env: NodeJS.ProcessEnv = process.env,
): Promise<GuardVerdict> {
  if (env.ALLOW_EDIT_ON_MAIN === "1") return ALLOW;
  const input = JSON.parse(inputJson) as {
    tool_name?: string;
    tool_input?: { file_path?: string; command?: string };
    cwd?: string;
  };
  let dir: string | null = null;
  if (input.tool_name && EDIT_TOOLS.has(input.tool_name)) {
    const fp = input.tool_input?.file_path;
    if (!fp) return ALLOW;
    dir = dirname(fp);
  } else if (input.tool_name === "Bash") {
    const command = input.tool_input?.command;
    if (!command) return ALLOW;
    if (command.includes("ALLOW_EDIT_ON_MAIN=1")) return ALLOW;
    dir = forbiddenGitDir(command, input.cwd || cwd);
    if (!dir) return ALLOW;
  } else {
    return ALLOW;
  }
  if (!(await dirExists(dir))) return ALLOW;
  const branch = await branchOf(dir);
  if (branch && branches.includes(branch)) {
    return {
      deny: true,
      reason: `BLOCKED on branch '${branch}' in ${dir}. CLAUDE.md: 'Never work off main directly'. Create a worktree first: git worktree add -b <slug> .worktrees/<slug> ${branch} — then work there. Bypass for one call: ALLOW_EDIT_ON_MAIN=1.`,
    };
  }
  return ALLOW;
}

// ---------------------------------------------------------------------------
// Generalized tool-stage guard dispatch — every enabled tool-stage guard rule
// runs through the single runner (dispatch, kind "guard"), so each is logged,
// and the first deny wins.
// ---------------------------------------------------------------------------

interface ToolCtx {
  inputJson: string;
  repoRoot: string;
  db: Db;
}

const TOOL_GUARDS: Record<
  string,
  (ctx: ToolCtx) => GuardVerdict | Promise<GuardVerdict>
> = {
  "lint-protected-paths": (ctx) =>
    evaluateGuard(
      ctx.inputJson,
      ctx.repoRoot,
      getDefaultProjectProtected(ctx.db),
    ),
  "gov-no-push-to-main": (ctx) =>
    evaluateMainBranch(ctx.inputJson, ctx.repoRoot),
};

/**
 * Evaluate every enabled tool-stage guard rule for a PreToolUse event, each
 * through dispatch (kind "guard", so it logs a run.start/run.end and a
 * hook_run), and return the first deny. Only rules with a registered evaluator participate;
 * others tagged `tool` are ignored here.
 */
export async function runToolGuards(
  inputJson: string,
  repoRoot: string,
  db: Db,
  auditDb: Db,
): Promise<GuardVerdict> {
  let decision: GuardVerdict = ALLOW;
  for (const d of selectDispatch(db, "tool")) {
    const evaluate = TOOL_GUARDS[d.slug];
    if (!evaluate) continue;
    const verdict = await dispatch(auditDb, {
      kind: "guard",
      slug: d.slug,
      stage: "tool",
      evaluate: () => evaluate({ inputJson, repoRoot, db }),
    });
    if (verdict.deny && !decision.deny) decision = verdict;
  }
  return decision;
}

/**
 * The single stdout payload for a PreToolUse guard: the deny decision (when a
 * guard blocks) plus, when the audit write failed, a visible `systemMessage` so a
 * broken log surfaces loudly. Combined into one JSON object. Returns null when
 * there is nothing to say (allowed, log succeeded).
 */
export function formatGuardOutput(
  decision: GuardVerdict,
  auditError?: string,
): string | null {
  const out: { systemMessage?: string; hookSpecificOutput?: unknown } = {};
  if (decision.deny) {
    out.hookSpecificOutput = {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: decision.reason,
    };
  }
  if (auditError !== undefined) {
    out.systemMessage = `captain-obvious: audit logging failed — ${auditError}`;
  }
  if (out.hookSpecificOutput === undefined && out.systemMessage === undefined) {
    return null;
  }
  return JSON.stringify(out);
}
