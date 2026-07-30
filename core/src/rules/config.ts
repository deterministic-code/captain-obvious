import type { Db } from "../db/open.js";

/**
 * A rule's effective config at check time: its global `config_json` overlaid by
 * the default project's per-rule override (`project_rules.config_json` for the
 * is_default project), so a panel edit reaches the running check. A pure read for
 * the git hooks, which run outside the server and must tolerate an un-provisioned
 * registry — a missing rule or project reads as {}.
 */
export function ruleConfigFromDb(db: Db, slug: string): Record<string, unknown> {
  const global = parseConfig(
    (
      db.prepare("SELECT config_json FROM rules WHERE slug = ?").get(slug) as
        | { config_json: string | null }
        | undefined
    )?.config_json,
  );
  const overlay = parseConfig(
    (
      db
        .prepare(
          `SELECT pr.config_json AS config_json
             FROM project_rules pr
             JOIN projects p ON p.id = pr.project_id
             JOIN rules r ON r.id = pr.rule_id
            WHERE p.is_default = 1 AND r.slug = ?`,
        )
        .get(slug) as { config_json: string | null } | undefined
    )?.config_json,
  );
  return { ...global, ...overlay };
}

function parseConfig(json: string | null | undefined): Record<string, unknown> {
  return json ? (JSON.parse(json) as Record<string, unknown>) : {};
}
