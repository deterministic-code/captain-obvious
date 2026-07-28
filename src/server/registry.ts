/**
 * Read/write helpers that shape the registry DB into the exact JSON payloads
 * the web Control Panel expects. The control panel is a prebuilt static bundle
 * (web/dist) that talks to these shapes verbatim, so field names here are load
 * bearing — see src/server/serve.ts for the routes that expose them.
 */
import { configureActionType } from "../db/actions.js";
import type { RuleAction } from "../db/fixes.js";
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
  /**
   * The rule's full category set (primary first). Additive field — the prebuilt
   * panel reads the scalar `category`; API/CLI consumers read this for the rest.
   */
  categories: string[];
  /**
   * The supported-language slugs this rule targets. Additive field — the
   * prebuilt panel ignores it; the panel augmentation (panelExt) reads it to
   * render/edit the Languages column.
   */
  languages: string[];
  /**
   * True when the rule targets no source language (zero `rule_languages` rows) —
   * it polices the repo/workflow, not files. Derived from `languages`, not
   * stored. Additive field — the prebuilt panel ignores it; panelExt reads it to
   * render the fixed "Language independent" cell instead of the language picker.
   */
  languageIndependent: boolean;
  stage: string | null;
  enabled: boolean;
  config: Record<string, unknown> | null;
  defaultAction: ActionView | null;
  envActions: EnvActionView[];
  /**
   * The rule's remediation/output actions (fixes table). Additive field — the
   * prebuilt panel ignores it; CLI (`show-rule`) and API consumers read it.
   */
  actions: RuleAction[];
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

/** Full category set with the primary first, then the rest in the query's (alpha) order. */
function orderCategories(primary: string | null, all: string[]): string[] {
  if (!primary) return all;
  return [primary, ...all.filter((c) => c !== primary)];
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

  const categoryRows = db
    .prepare(
      "SELECT rule_id AS ruleId, category FROM rule_categories ORDER BY category",
    )
    .all() as { ruleId: number; category: string }[];
  const categoriesByRule = new Map<number, string[]>();
  for (const c of categoryRows) {
    const list = categoriesByRule.get(c.ruleId) ?? [];
    list.push(c.category);
    categoriesByRule.set(c.ruleId, list);
  }

  const languageRows = db
    .prepare(
      `SELECT rl.rule_id AS ruleId, l.slug AS slug
         FROM rule_languages rl
         JOIN languages l ON l.id = rl.language_id
        ORDER BY l.slug`,
    )
    .all() as { ruleId: number; slug: string }[];
  const languagesByRule = new Map<number, string[]>();
  for (const l of languageRows) {
    const list = languagesByRule.get(l.ruleId) ?? [];
    list.push(l.slug);
    languagesByRule.set(l.ruleId, list);
  }

  // Rule actions (fixes table): one grouped read, then split per rule.
  const fixRows = db
    .prepare(
      `SELECT rule_id AS ruleId, kind, script_path AS scriptPath,
              script_body AS scriptBody, description
         FROM fixes ORDER BY id`,
    )
    .all() as {
    ruleId: number;
    kind: RuleAction["kind"];
    scriptPath: string | null;
    scriptBody: string | null;
    description: string | null;
  }[];
  const fixesByRule = new Map<number, RuleAction[]>();
  for (const f of fixRows) {
    const list = fixesByRule.get(f.ruleId) ?? [];
    list.push({
      kind: f.kind,
      ...(f.scriptPath !== null ? { scriptPath: f.scriptPath } : {}),
      ...(f.scriptBody !== null ? { scriptBody: f.scriptBody } : {}),
      ...(f.description !== null ? { description: f.description } : {}),
    });
    fixesByRule.set(f.ruleId, list);
  }

  return rules.map((r) => {
    const bindings = byRule.get(r.id) ?? [];
    const def = bindings.find((b) => b.environment === null);
    const envActions = bindings
      .filter((b) => b.environment !== null)
      .map((b) => ({ environment: b.environment as string, type: b.type }));
    const languages = languagesByRule.get(r.id) ?? [];
    return {
      slug: r.slug,
      name: r.name,
      description: r.description,
      category: r.category,
      categories: orderCategories(r.category, categoriesByRule.get(r.id) ?? []),
      languages,
      languageIndependent: languages.length === 0,
      stage: META_BY_SLUG.get(r.slug)?.stage ?? null,
      enabled: r.enabled === 1,
      config: parseConfig(r.config_json),
      defaultAction: def ? { type: def.type, delayMs: def.delayMs } : null,
      envActions,
      actions: fixesByRule.get(r.id) ?? [],
    };
  });
}

export interface MetaView {
  actionTypes: { slug: string; name: string }[];
  environments: { slug: string; name: string }[];
  /**
   * Supported languages only (is_supported = 1). Additive field — the prebuilt
   * panel ignores it; the panel augmentation (panelExt) uses it to populate the
   * language filter and the per-row Languages picker.
   */
  languages: { slug: string; name: string }[];
}

/** GET /api/meta — dropdown sources for the action/environment/language selectors. */
export function getMeta(db: Db): MetaView {
  return {
    actionTypes: db
      .prepare("SELECT slug, name FROM action_types ORDER BY name")
      .all() as MetaView["actionTypes"],
    environments: db
      .prepare("SELECT slug, name FROM environments ORDER BY name")
      .all() as MetaView["environments"],
    languages: db
      .prepare(
        "SELECT slug, name FROM languages WHERE is_supported = 1 ORDER BY name",
      )
      .all() as MetaView["languages"],
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
  /** The rule's full desired language set; diffed against the current links. */
  languages?: string[];
}

/** The rule's currently-linked language slugs. */
function currentLanguages(db: Db, slug: string): string[] {
  return (
    db
      .prepare(
        `SELECT l.slug AS slug
           FROM rule_languages rl
           JOIN languages l ON l.id = rl.language_id
           JOIN rules r ON r.id = rl.rule_id
          WHERE r.slug = ?`,
      )
      .all(slug) as { slug: string }[]
  ).map((r) => r.slug);
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
  if (patch.languages !== undefined) {
    const current = new Set(currentLanguages(db, slug));
    const desired = new Set(patch.languages);
    const addLanguages = [...desired].filter((s) => !current.has(s));
    const removeLanguages = [...current].filter((s) => !desired.has(s));
    if (addLanguages.length > 0 || removeLanguages.length > 0) {
      configureRule(db, slug, { addLanguages, removeLanguages });
    }
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
