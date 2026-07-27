/**
 * Read/write helpers that shape the registry DB into the exact JSON payloads
 * the web Control Panel expects. The control panel is a prebuilt static bundle
 * (web/dist) that talks to these shapes verbatim, so field names here are load
 * bearing — see src/server/serve.ts for the routes that expose them.
 */
import { configureActionType } from "../db/actions.js";
import { configureRule } from "../db/rules.js";
import { seedRules, type SeedSummary } from "../db/seed.js";
import type { Db } from "../db/open.js";
import type { RuleRow } from "../db/types.js";
import { RULES } from "../rules/index.js";

/** slug -> registry metadata (the DB has no `stage` column; it lives here). */
const META_BY_SLUG = new Map(RULES.map((r) => [r.meta.slug, r.meta]));

export interface ActionView {
  type: string;
  delayMs?: number | null;
}
export interface EnvActionView {
  environment: string;
  type: string;
}
export interface RuleView {
  slug: string;
  name: string;
  description: string | null;
  category: string | null;
  stage: string | null;
  enabled: boolean;
  config: Record<string, unknown> | null;
  defaultAction: ActionView | null;
  envActions: EnvActionView[];
}

function parseConfig(json: string | null): Record<string, unknown> | null {
  if (!json) return null;
  try {
    const value = JSON.parse(json);
    return value && typeof value === "object" ? value : null;
  } catch {
    return null;
  }
}

/** GET /api/rules — every rule with its actions resolved to slugs. */
export function listRules(db: Db): RuleView[] {
  const rules = db
    .prepare("SELECT * FROM rules ORDER BY category, slug")
    .all() as RuleRow[];

  const actions = db
    .prepare(
      `SELECT ra.rule_id AS ruleId, e.slug AS environment, at.slug AS type,
              ra.delay_ms AS delayMs
         FROM rule_actions ra
         JOIN action_types at ON at.id = ra.action_type_id
         LEFT JOIN environments e ON e.id = ra.environment_id`,
    )
    .all() as {
    ruleId: number;
    environment: string | null;
    type: string;
    delayMs: number | null;
  }[];

  const byRule = new Map<number, typeof actions>();
  for (const a of actions) {
    const list = byRule.get(a.ruleId) ?? [];
    list.push(a);
    byRule.set(a.ruleId, list);
  }

  return rules.map((r) => {
    const bindings = byRule.get(r.id) ?? [];
    const def = bindings.find((b) => b.environment === null);
    const envActions = bindings
      .filter((b) => b.environment !== null)
      .map((b) => ({ environment: b.environment as string, type: b.type }));
    return {
      slug: r.slug,
      name: r.name,
      description: r.description,
      category: r.category,
      stage: META_BY_SLUG.get(r.slug)?.stage ?? null,
      enabled: r.enabled === 1,
      config: parseConfig(r.config_json),
      defaultAction: def ? { type: def.type, delayMs: def.delayMs } : null,
      envActions,
    };
  });
}

export interface MetaView {
  actionTypes: { slug: string; name: string }[];
  environments: { slug: string; name: string }[];
}

/** GET /api/meta — dropdown sources for the action/environment selectors. */
export function getMeta(db: Db): MetaView {
  return {
    actionTypes: db
      .prepare("SELECT slug, name FROM action_types ORDER BY name")
      .all() as MetaView["actionTypes"],
    environments: db
      .prepare("SELECT slug, name FROM environments ORDER BY name")
      .all() as MetaView["environments"],
  };
}

export interface StatsView {
  total: number;
  enabled: number;
  disabled: number;
  byCategory: Record<string, number>;
  byActionType: Record<string, number>;
  byStage: Record<string, number>;
}

/** GET /api/stats — headline counts + the three bar-chart breakdowns. */
export function getStats(db: Db): StatsView {
  const rules = db
    .prepare("SELECT slug, category, enabled FROM rules")
    .all() as Pick<RuleRow, "slug" | "category" | "enabled">[];

  const byCategory: Record<string, number> = {};
  const byStage: Record<string, number> = {};
  let enabled = 0;
  for (const r of rules) {
    if (r.enabled === 1) enabled += 1;
    const cat = r.category ?? "uncategorized";
    byCategory[cat] = (byCategory[cat] ?? 0) + 1;
    const stage = META_BY_SLUG.get(r.slug)?.stage ?? "unknown";
    byStage[stage] = (byStage[stage] ?? 0) + 1;
  }

  const actionRows = db
    .prepare(
      `SELECT at.slug AS type, COUNT(*) AS n
         FROM rule_actions ra
         JOIN action_types at ON at.id = ra.action_type_id
        WHERE ra.environment_id IS NULL
        GROUP BY at.slug`,
    )
    .all() as { type: string; n: number }[];
  const byActionType: Record<string, number> = {};
  for (const row of actionRows) byActionType[row.type] = row.n;

  return {
    total: rules.length,
    enabled,
    disabled: rules.length - enabled,
    byCategory,
    byActionType,
    byStage,
  };
}

/** The mutually-exclusive PATCH /api/rules/:slug body shapes. */
export interface RulePatch {
  enabled?: boolean;
  config?: Record<string, unknown>;
  setAction?: { type: string; environment?: string; delayMs?: number | null };
  removeAction?: string;
}

/** PATCH /api/rules/:slug — apply one edit and return the updated view. */
export function patchRule(db: Db, slug: string, patch: RulePatch): RuleView {
  if (patch.enabled !== undefined) {
    configureRule(db, slug, { enabled: patch.enabled });
  }
  if (patch.config !== undefined) {
    configureRule(db, slug, { setConfig: JSON.stringify(patch.config) });
  }
  if (patch.setAction) {
    configureRule(db, slug, {
      setAction: {
        type: patch.setAction.type,
        environment: patch.setAction.environment ?? null,
        delayMs: patch.setAction.delayMs ?? null,
      },
    });
  }
  if (patch.removeAction) {
    configureRule(db, slug, { removeAction: patch.removeAction });
  }
  const view = listRules(db).find((r) => r.slug === slug);
  if (!view) throw new Error(`unknown rule: ${slug}`);
  return view;
}

/** POST /api/seed — populate the registry from the bundled rule set. */
export function seed(db: Db): SeedSummary {
  return seedRules(db, RULES);
}

/** POST /api/action-types — add (or rename) an action type. */
export function addActionType(
  db: Db,
  body: { slug?: string; name?: string; add?: boolean },
): { slug: string; name: string } {
  const slug = (body.slug ?? "").trim();
  if (!slug) throw new Error("slug is required");
  return configureActionType(db, slug, { add: body.add ?? true, name: body.name });
}
