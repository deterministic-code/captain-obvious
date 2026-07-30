import { logEvent } from "./audit.js";
import { setRuleFixesTx } from "./fixes.js";
import { isUniqueViolation } from "./languages.js";
import {
  requireActionTypeId,
  requireEnvironmentId,
  requireLanguageId,
  requireRule,
} from "./lookups.js";
import type { Db } from "./open.js";
import type { RulePlugin } from "../rules/plugin.js";
import { requireStage } from "../rules/stages.js";
import type {
  ActionBinding,
  AddRuleOpts,
  ConfigureRuleOpts,
  RuleRow,
} from "./types.js";

/**
 * Insert a rule and link it to languages, categories, and stages. All referenced
 * slugs must be valid; validation happens before any write and the whole thing
 * runs in a transaction, so a bad reference leaves no partial rows.
 */
export function addRule(db: Db, opts: AddRuleOpts): RuleRow {
  const { slug, name, category, categories, description, languages, config, stages } =
    opts;
  if (!slug || !name) throw new Error("add-rule requires --slug and --name");
  const configJson = normalizeConfig(config);

  const languageIds = (languages ?? []).map((s) => requireLanguageId(db, s));
  const stageSlugs = (stages ?? []).map((s) => requireStage(s));

  const insert = db.transaction((): RuleRow => {
    let ruleId: number | bigint;
    try {
      ruleId = db
        .prepare(
          "INSERT INTO rules (slug, name, category, description, config_json) VALUES (?, ?, ?, ?, ?)",
        )
        .run(slug, name, category ?? null, description ?? null, configJson)
        .lastInsertRowid;
    } catch (err) {
      if (isUniqueViolation(err)) throw new Error(`rule already exists: ${slug}`);
      throw err;
    }
    const linkLang = db.prepare(
      "INSERT INTO rule_languages (rule_id, language_id) VALUES (?, ?)",
    );
    for (const id of languageIds) linkLang.run(ruleId, id);
    linkCategories(db, ruleId, categorySet(category, categories));
    linkStages(db, ruleId, stageSlugs);
    return db.prepare("SELECT * FROM rules WHERE id = ?").get(ruleId) as RuleRow;
  });

  const row = insert();
  logEvent("rule.added", `added rule ${slug}`);
  return row;
}

/** The rule's full category set: primary first, then extras, de-duplicated, empties dropped. */
function categorySet(
  primary: string | null | undefined,
  extras: string[] | undefined,
): string[] {
  const out: string[] = [];
  for (const c of [primary, ...(extras ?? [])]) {
    if (c && !out.includes(c)) out.push(c);
  }
  return out;
}

/** Replace a rule's category links with the given full set. */
function linkCategories(
  db: Db,
  ruleId: number | bigint,
  categories: string[],
): void {
  db.prepare("DELETE FROM rule_categories WHERE rule_id = ?").run(ruleId);
  const link = db.prepare(
    "INSERT INTO rule_categories (rule_id, category) VALUES (?, ?)",
  );
  for (const c of categories) link.run(ruleId, c);
}

/** Replace a rule's stage links with the given set (callers validate the slugs). */
function linkStages(db: Db, ruleId: number | bigint, stages: string[]): void {
  db.prepare("DELETE FROM rule_stages WHERE rule_id = ?").run(ruleId);
  const link = db.prepare(
    "INSERT INTO rule_stages (rule_id, stage) VALUES (?, ?)",
  );
  for (const s of stages) link.run(ruleId, s);
}

/**
 * Keep rules.category (the primary) consistent with the rule_categories set
 * after edits: if the current primary is gone (or never set), re-point it to the
 * first remaining category, or null when none remain.
 */
function reconcilePrimaryCategory(db: Db, ruleId: number): void {
  const current = db
    .prepare("SELECT category FROM rules WHERE id = ?")
    .get(ruleId) as { category: string | null };
  const remaining = (
    db
      .prepare(
        "SELECT category FROM rule_categories WHERE rule_id = ? ORDER BY category",
      )
      .all(ruleId) as { category: string }[]
  ).map((r) => r.category);
  if (current.category && remaining.includes(current.category)) return;
  db.prepare("UPDATE rules SET category = ? WHERE id = ?").run(
    remaining[0] ?? null,
    ruleId,
  );
}

/**
 * Update a rule's settings (config, enabled, languages) and its per-environment
 * action bindings. Every requested change is validated up front and applied in
 * one transaction.
 */
export function configureRule(
  db: Db,
  slug: string,
  opts: ConfigureRuleOpts,
): RuleRow {
  const rule = requireRule(db, slug);
  const configJson =
    opts.setConfig !== undefined ? normalizeConfig(opts.setConfig) : undefined;
  const addLangIds = (opts.addLanguages ?? []).map((s) => requireLanguageId(db, s));
  const removeLangIds = (opts.removeLanguages ?? []).map((s) =>
    requireLanguageId(db, s),
  );
  const setStageSlugs = opts.setStages?.map((s) => requireStage(s));
  const binding = opts.setAction
    ? resolveBinding(db, opts.setAction)
    : undefined;

  const apply = db.transaction((): RuleRow => {
    if (configJson !== undefined) {
      db.prepare("UPDATE rules SET config_json = ? WHERE id = ?").run(
        configJson,
        rule.id,
      );
    }
    if (opts.enabled !== undefined) {
      db.prepare("UPDATE rules SET enabled = ? WHERE id = ?").run(
        opts.enabled ? 1 : 0,
        rule.id,
      );
    }
    const linkLang = db.prepare(
      "INSERT OR IGNORE INTO rule_languages (rule_id, language_id) VALUES (?, ?)",
    );
    for (const id of addLangIds) linkLang.run(rule.id, id);
    const unlinkLang = db.prepare(
      "DELETE FROM rule_languages WHERE rule_id = ? AND language_id = ?",
    );
    for (const id of removeLangIds) unlinkLang.run(rule.id, id);

    const addCategories = opts.addCategories ?? [];
    const removeCategories = opts.removeCategories ?? [];
    const linkCat = db.prepare(
      "INSERT OR IGNORE INTO rule_categories (rule_id, category) VALUES (?, ?)",
    );
    for (const c of addCategories) linkCat.run(rule.id, c);
    const unlinkCat = db.prepare(
      "DELETE FROM rule_categories WHERE rule_id = ? AND category = ?",
    );
    for (const c of removeCategories) unlinkCat.run(rule.id, c);
    if (addCategories.length || removeCategories.length) {
      reconcilePrimaryCategory(db, rule.id);
    }

    if (setStageSlugs !== undefined) linkStages(db, rule.id, setStageSlugs);

    if (binding) setRuleAction(db, rule.id, binding);
    if (opts.removeAction) removeRuleAction(db, rule.id, opts.removeAction);

    return db.prepare("SELECT * FROM rules WHERE id = ?").get(rule.id) as RuleRow;
  });

  const row = apply();
  auditConfigureRule(slug, opts, configJson !== undefined);
  return row;
}

/** Emit one audit event per distinct change a configureRule call made. */
function auditConfigureRule(
  slug: string,
  opts: ConfigureRuleOpts,
  configChanged: boolean,
): void {
  if (opts.enabled === true) logEvent("rule.enabled", `enabled rule ${slug}`);
  if (opts.enabled === false) logEvent("rule.disabled", `disabled rule ${slug}`);
  if (configChanged) logEvent("rule.configured", `updated config for rule ${slug}`);
  if ((opts.addLanguages?.length ?? 0) + (opts.removeLanguages?.length ?? 0) > 0) {
    logEvent("rule.configured", `updated languages for rule ${slug}`);
  }
  if ((opts.addCategories?.length ?? 0) + (opts.removeCategories?.length ?? 0) > 0) {
    logEvent("rule.configured", `updated categories for rule ${slug}`);
  }
  if (opts.setStages !== undefined) {
    logEvent("rule.configured", `updated stages for rule ${slug}`);
  }
  if (opts.setAction) {
    const env = opts.setAction.environment ?? "all environments";
    logEvent("severity.set", `set ${opts.setAction.type} on rule ${slug} for ${env}`);
  }
  if (opts.removeAction) {
    logEvent(
      "severity.removed",
      `removed action binding (${opts.removeAction}) on rule ${slug}`,
    );
  }
}

export interface ResolvedBinding {
  environmentId: number | null;
  actionTypeId: number;
  delayMs: number | null;
}

export function resolveBinding(db: Db, b: ActionBinding): ResolvedBinding {
  return {
    environmentId: b.environment ? requireEnvironmentId(db, b.environment) : null,
    actionTypeId: requireActionTypeId(db, b.type),
    delayMs: b.delayMs,
  };
}

/**
 * Upsert one rule_action. Done as delete-then-insert because the
 * UNIQUE(rule_id, environment_id) constraint does NOT catch duplicate default
 * bindings (SQLite treats NULL environment_id values as distinct), so ON
 * CONFLICT would not fire for the default (all-env) row.
 */
function setRuleAction(db: Db, ruleId: number, b: ResolvedBinding): void {
  if (b.environmentId === null) {
    db.prepare(
      "DELETE FROM rule_actions WHERE rule_id = ? AND environment_id IS NULL",
    ).run(ruleId);
  } else {
    db.prepare(
      "DELETE FROM rule_actions WHERE rule_id = ? AND environment_id = ?",
    ).run(ruleId, b.environmentId);
  }
  db.prepare(
    "INSERT INTO rule_actions (rule_id, environment_id, action_type_id, delay_ms) VALUES (?, ?, ?, ?)",
  ).run(ruleId, b.environmentId, b.actionTypeId, b.delayMs);
}

function removeRuleAction(db: Db, ruleId: number, target: string): void {
  if (target === "all") {
    db.prepare("DELETE FROM rule_actions WHERE rule_id = ?").run(ruleId);
  } else if (target === "default") {
    db.prepare(
      "DELETE FROM rule_actions WHERE rule_id = ? AND environment_id IS NULL",
    ).run(ruleId);
  } else {
    const envId = requireEnvironmentId(db, target);
    db.prepare(
      "DELETE FROM rule_actions WHERE rule_id = ? AND environment_id = ?",
    ).run(ruleId, envId);
  }
}

/**
 * Register a rule plugin into the catalog: idempotently insert-or-update its row
 * (config, control spec, dependencies) and sync its language, category, and stage
 * links plus its fixes. Used by `seed-rules`. Preserves `enabled` so re-seeding
 * never re-enables a rule a user turned off. Languages must already exist (the
 * seeder ensures them first). `meta.actions` undefined leaves existing fixes
 * alone; `[]` clears them.
 */
export function registerRule(db: Db, plugin: RulePlugin): void {
  const { meta } = plugin;
  const configJson = meta.config ? JSON.stringify(meta.config) : null;
  const controlJson = plugin.control ? JSON.stringify(plugin.control) : null;
  const depsJson =
    plugin.dependencies && plugin.dependencies.length > 0
      ? JSON.stringify(plugin.dependencies)
      : null;
  const languageIds = meta.languages.map((s) => requireLanguageId(db, s));

  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO rules (slug, name, category, description, config_json, control_json, deps_json)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(slug) DO UPDATE SET
         name = excluded.name,
         category = excluded.category,
         description = excluded.description,
         config_json = excluded.config_json,
         control_json = excluded.control_json,
         deps_json = excluded.deps_json`,
    ).run(
      meta.slug,
      meta.name,
      meta.category,
      meta.description,
      configJson,
      controlJson,
      depsJson,
    );

    const ruleId = (
      db.prepare("SELECT id FROM rules WHERE slug = ?").get(meta.slug) as {
        id: number;
      }
    ).id;
    db.prepare("DELETE FROM rule_languages WHERE rule_id = ?").run(ruleId);
    const link = db.prepare(
      "INSERT INTO rule_languages (rule_id, language_id) VALUES (?, ?)",
    );
    for (const id of languageIds) link.run(ruleId, id);

    linkCategories(db, ruleId, categorySet(meta.category, meta.categories));
    linkStages(db, ruleId, meta.stages);

    if (meta.actions !== undefined) setRuleFixesTx(db, ruleId, meta.actions);
  });

  tx();
}

/** Validate a raw config string as JSON, returning it as-is (or null). */
function normalizeConfig(config: string | undefined): string | null {
  if (config === undefined) return null;
  try {
    JSON.parse(config);
  } catch {
    throw new Error(`--config is not valid JSON: ${config}`);
  }
  return config;
}
