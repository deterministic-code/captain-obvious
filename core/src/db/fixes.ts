/**
 * A rule's actions live in the `fixes` table (one rule -> 0..N actions). The
 * rule itself is the check; an action is what to do about a violation — a
 * deterministic 'script' fix, an 'inferred' (model-driven) fix, or an 'output'
 * that only reports to the user.
 */
import { requireRule } from "./lookups.js";
import type { Db } from "./open.js";
import type { FixKind } from "./types.js";

export interface RuleAction {
  kind: FixKind;
  scriptPath?: string;
  scriptBody?: string;
  description?: string;
}

const KINDS: readonly FixKind[] = ["inferred", "script", "output"];

function validate(action: RuleAction): void {
  if (!KINDS.includes(action.kind)) {
    throw new Error(`unknown action kind: ${action.kind}`);
  }
  // Mirrors the schema CHECK: only 'script' actions require a script.
  if (
    action.kind === "script" &&
    action.scriptPath === undefined &&
    action.scriptBody === undefined
  ) {
    throw new Error("script action requires scriptPath or scriptBody");
  }
}

/**
 * Replace a rule's actions in-place, without opening its own transaction. Assumes
 * the caller (e.g. seedRules) is already inside one — better-sqlite3 forbids
 * nested transactions. Callers that are NOT in a transaction should use
 * `setRuleFixes`, which wraps this.
 */
export function setRuleFixesTx(
  db: Db,
  ruleId: number,
  actions: RuleAction[],
): void {
  db.prepare("DELETE FROM fixes WHERE rule_id = ?").run(ruleId);
  const insert = db.prepare(
    `INSERT INTO fixes (rule_id, kind, script_path, script_body, description)
       VALUES (?, ?, ?, ?, ?)`,
  );
  for (const a of actions) {
    insert.run(
      ruleId,
      a.kind,
      a.scriptPath ?? null,
      a.scriptBody ?? null,
      a.description ?? null,
    );
  }
}

/**
 * Replace a rule's actions with exactly `actions`. Idempotent: validates every
 * action first, then delete-then-insert inside one transaction. An empty array
 * clears all actions. Unknown rule throws.
 */
export function setRuleFixes(
  db: Db,
  ruleSlug: string,
  actions: RuleAction[],
): void {
  const rule = requireRule(db, ruleSlug);
  for (const a of actions) validate(a);
  db.transaction(() => setRuleFixesTx(db, rule.id, actions))();
}

/** Read a rule's actions, ordered by id (insertion order). */
export function getRuleFixes(db: Db, ruleSlug: string): RuleAction[] {
  const rule = requireRule(db, ruleSlug);
  const rows = db
    .prepare(
      `SELECT kind, script_path AS scriptPath, script_body AS scriptBody,
              description
         FROM fixes WHERE rule_id = ? ORDER BY id`,
    )
    .all(rule.id) as {
    kind: FixKind;
    scriptPath: string | null;
    scriptBody: string | null;
    description: string | null;
  }[];
  return rows.map((r) => ({
    kind: r.kind,
    ...(r.scriptPath !== null ? { scriptPath: r.scriptPath } : {}),
    ...(r.scriptBody !== null ? { scriptBody: r.scriptBody } : {}),
    ...(r.description !== null ? { description: r.description } : {}),
  }));
}
