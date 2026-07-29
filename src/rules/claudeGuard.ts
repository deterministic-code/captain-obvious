import { relative } from "node:path";
import { getDefaultProjectProtected } from "../db/projects.js";
import type { Db } from "../db/open.js";
import { selectDispatch } from "./dispatch.js";
import { matchProtected } from "./protectedPaths.js";

/** Claude Code PreToolUse tools that carry a `file_path` we can guard. */
const EDIT_TOOLS = new Set(["Edit", "Write", "NotebookEdit"]);

export interface GuardDecision {
  deny: boolean;
  reason?: string;
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
 * The guard decision for a PreToolUse event against the registry `db`: runs only
 * when the `lint-protected-paths` rule is enabled at the `claude-tool` stage.
 */
export function guardDecision(
  inputJson: string,
  repoRoot: string,
  db: Db,
): GuardDecision {
  const selected = selectDispatch(db, "claude-tool");
  if (!selected.some((d) => d.slug === "lint-protected-paths")) return ALLOW;
  return evaluateGuard(inputJson, repoRoot, getDefaultProjectProtected(db));
}

/** The PreToolUse JSON that tells Claude Code to deny the tool call. */
export function formatDeny(reason: string): string {
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: reason,
    },
  });
}
