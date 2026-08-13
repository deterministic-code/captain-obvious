import { relative } from "node:path";
import type { HookRunRecord } from "../db/audit.js";
import { getDefaultProjectProtected } from "../db/projects.js";
import type { Db } from "../db/open.js";
import { selectDispatch } from "./dispatch.js";
import { matchProtected } from "./protectedPaths.js";

/** Claude Code PreToolUse tools that carry a `file_path` we can guard. */
const EDIT_TOOLS = new Set(["Edit", "Write", "NotebookEdit"]);

/** The one tool-stage rule this guard enforces; other rules may be tagged at `tool` but are not run here. */
const PROTECTED_PATHS_SLUG = "lint-protected-paths";

export interface GuardDecision {
  deny: boolean;
  reason?: string;
}

/** The Activity row a guard evaluation produces; the shim stamps its timing. */
export type GuardRun = Omit<HookRunRecord, "startedMs" | "durationMs">;

export interface GuardResult {
  decision: GuardDecision;
  /** The hook_run to log for this PreToolUse, or null when the rule didn't run. */
  run: GuardRun | null;
}

const ALLOW: GuardDecision = { deny: false };

/**
 * Decide whether a PreToolUse event touches a protected path. `inputJson` is the
 * raw hook stdin; `repoRoot` is the git top-level the edited path is relative to.
 * Fail-open on tools/inputs we don't guard (a guard must never crash a benign
 * edit); deny only a concrete in-repo file that matches a protected glob.
 */
export function evaluateGuard(
  inputJson: string,
  repoRoot: string,
  globs: string[],
): GuardDecision {
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

/**
 * The guard decision for a PreToolUse event against the registry `db`, plus the
 * Activity row to log. `lint-protected-paths` runs only when enabled at the
 * `tool` stage; when it runs, every evaluation yields a `run` (a `failure`
 * when it blocks, `success` when it allows) so the tool path shows up in
 * Activity the same way git-stage dispatches do. `run` is null when the rule is
 * disabled — nothing ran, so nothing is logged.
 */
export function guardDecision(
  inputJson: string,
  repoRoot: string,
  db: Db,
): GuardResult {
  const selected = selectDispatch(db, "tool");
  if (!selected.some((d) => d.slug === PROTECTED_PATHS_SLUG)) {
    return { decision: ALLOW, run: null };
  }
  const decision = evaluateGuard(
    inputJson,
    repoRoot,
    getDefaultProjectProtected(db),
  );
  return {
    decision,
    run: {
      slug: PROTECTED_PATHS_SLUG,
      stage: "tool",
      status: decision.deny ? "failure" : "success",
    },
  };
}

/**
 * The single stdout payload for a PreToolUse guard: the deny decision (when the
 * guard blocks) plus, when the audit write failed, a user-visible `systemMessage`
 * so a broken log surfaces loudly instead of vanishing into the shim's fail-open
 * catch. Combined into one JSON object so the decision and the warning can't race
 * as two lines. Returns null when there's nothing to say (allowed, log succeeded).
 */
export function formatGuardOutput(
  decision: GuardDecision,
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
