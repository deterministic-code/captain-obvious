/**
 * Read/write helpers that shape the registry DB into the exact JSON payloads
 * the web Control Panel expects. The control panel is a prebuilt static bundle
 * (web/dist) that talks to these shapes verbatim, so field names here are load
 * bearing — see src/server/serve.ts for the routes that expose them.
 */
import { configureActionType } from "../db/actions.js";
import type { RuleAction } from "../db/fixes.js";
import {
  addProject,
  configureProject,
  getProject,
  listProjects as listProjectRows,
  setProjectRule,
  syncProjectRules,
} from "../db/projects.js";
import { configureRule, reorderRule } from "../db/rules.js";
import { seedRules, type SeedSummary } from "../db/seed.js";
import type { Db } from "../db/open.js";
import { resolveMode, type Mode } from "../db/location.js";
import type { ProjectRow, RuleRow } from "../db/types.js";
import { FIX_ACTIONS } from "../rules/action-behavior.js";
import { RULES } from "../rules/index.js";
import type { ControlSpec, RuleDependency } from "../rules/plugin.js";
import { STAGES, stageOrder } from "../rules/stages.js";

interface ActionView {
  type: string;
  delayMs?: number | null;
}
interface EnvActionView {
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
  /** The rule's earliest stage (canonical order) — the scalar the prebuilt panel reads. */
  stage: string | null;
  /**
   * The rule's full stage set in canonical order. Additive field — the prebuilt
   * panel reads the scalar `stage`; panelExt reads this to render/edit the Stage
   * column, and the dispatcher reads rule_stages directly.
   */
  stages: string[];
  /**
   * The rule's execution/display order (rules.sort_index), ascending. Additive
   * field — the prebuilt panel ignores it; panelExt reads it and renders the
   * per-row reorder arrows that PATCH `{ move }`.
   */
  order: number;
  enabled: boolean;
  config: Record<string, unknown> | null;
  defaultAction: ActionView | null;
  envActions: EnvActionView[];
  /**
   * The rule's remediation/output actions (fixes table). Additive field — the
   * prebuilt panel ignores it; CLI (`show-rule`) and API consumers read it.
   */
  actions: RuleAction[];
  /**
   * The rule's settings-dialog spec: a declarative field schema panelExt renders
   * generically, a custom control key, or null for the default dialog. Additive
   * field — the prebuilt panel ignores it; panelExt reads it.
   */
  control: ControlSpec | null;
  /**
   * External tools/packages the rule's check needs. Additive field — the prebuilt
   * panel ignores it; the CLI (`check-deps`) and panelExt read it.
   */
  deps: RuleDependency[];
  /**
   * Custom panel-control keys, derived from `control` for the prebuilt panel's
   * current settings dialog. Transitional — superseded by `control` once panelExt
   * reads the new field; kept emitting so the shipped panel keeps working.
   */
  settingsControls: string[];
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

function parseControl(json: string | null): ControlSpec | null {
  return json ? (JSON.parse(json) as ControlSpec) : null;
}

function parseDeps(json: string | null): RuleDependency[] {
  return json ? (JSON.parse(json) as RuleDependency[]) : [];
}

/** The prebuilt panel's custom-control keys, derived from the new control spec. */
function controlKeys(control: ControlSpec | null): string[] {
  return control?.kind === "custom" ? [control.key] : [];
}

/** Full category set with the primary first, then the rest in the query's (alpha) order. */
function orderCategories(primary: string | null, all: string[]): string[] {
  if (!primary) return all;
  return [primary, ...all.filter((c) => c !== primary)];
}

/** GET /api/rules — every rule with its actions resolved to slugs. */
export function listRules(db: Db): RuleView[] {
  const rules = db
    .prepare("SELECT * FROM rules ORDER BY sort_index, slug")
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

  const stageRows = db
    .prepare("SELECT rule_id AS ruleId, stage FROM rule_stages")
    .all() as { ruleId: number; stage: string }[];
  const stagesByRule = new Map<number, string[]>();
  for (const s of stageRows) {
    const list = stagesByRule.get(s.ruleId) ?? [];
    list.push(s.stage);
    stagesByRule.set(s.ruleId, list);
  }
  for (const list of stagesByRule.values()) {
    list.sort((a, b) => stageOrder(a) - stageOrder(b));
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
    const stages = stagesByRule.get(r.id) ?? [];
    const control = parseControl(r.control_json);
    return {
      slug: r.slug,
      name: r.name,
      description: r.description,
      category: r.category,
      categories: orderCategories(r.category, categoriesByRule.get(r.id) ?? []),
      languages,
      languageIndependent: languages.length === 0,
      stage: stages[0] ?? null,
      stages,
      order: r.sort_index,
      enabled: r.enabled === 1,
      config: parseConfig(r.config_json),
      defaultAction: def ? { type: def.type, delayMs: def.delayMs } : null,
      envActions,
      actions: fixesByRule.get(r.id) ?? [],
      control,
      deps: parseDeps(r.deps_json),
      settingsControls: controlKeys(control),
    };
  });
}

export interface MetaView {
  /**
   * `requiresFix` is an additive field the prebuilt panel ignores; panelExt uses
   * it to offer the fix actions (Fix / Fix and Warn / Fix and Halt) only for
   * rules that declare a deterministic `script` fix.
   */
  actionTypes: { slug: string; name: string; requiresFix: boolean }[];
  environments: { slug: string; name: string }[];
  /**
   * Supported languages only (is_supported = 1). Additive field — the prebuilt
   * panel ignores it; the panel augmentation (panelExt) uses it to populate the
   * language filter and the per-row Languages picker.
   */
  languages: { slug: string; name: string }[];
  /**
   * The canonical stage list, in order. Additive field — the prebuilt panel
   * ignores it; panelExt uses it to populate the per-row Stage picker.
   */
  stages: { slug: string; name: string }[];
}

/** GET /api/meta — dropdown sources for the action/environment/language/stage selectors. */
export function getMeta(db: Db): MetaView {
  return {
    actionTypes: (
      db.prepare("SELECT slug, name FROM action_types ORDER BY name").all() as {
        slug: string;
        name: string;
      }[]
    ).map((a) => ({ ...a, requiresFix: FIX_ACTIONS.includes(a.slug) })),
    environments: db
      .prepare("SELECT slug, name FROM environments ORDER BY name")
      .all() as MetaView["environments"],
    languages: db
      .prepare(
        "SELECT slug, name FROM languages WHERE is_supported = 1 ORDER BY name",
      )
      .all() as MetaView["languages"],
    stages: STAGES.map((s) => ({ slug: s.slug, name: s.name })),
  };
}

export interface ModeView {
  mode: Mode;
  dbPath: string;
  auditDbPath: string;
}

/**
 * GET /api/mode — which DB set the server opened: `local` (project-fixed) vs
 * `global` (machine-wide), plus the resolved file paths for the panel's tooltip.
 * Additive route — the prebuilt panel ignores it; panelExt renders the badge.
 */
export function getMode(dbPath: string, auditDbPath: string): ModeView {
  return { mode: resolveMode(), dbPath, auditDbPath };
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
  let enabled = 0;
  for (const r of rules) {
    if (r.enabled === 1) enabled += 1;
    const cat = r.category ?? "uncategorized";
    byCategory[cat] = (byCategory[cat] ?? 0) + 1;
  }

  // A rule counts once per stage it runs at, so this comes from rule_stages.
  const stageRows = db
    .prepare("SELECT stage, COUNT(*) AS n FROM rule_stages GROUP BY stage")
    .all() as { stage: string; n: number }[];
  const byStage: Record<string, number> = {};
  for (const row of stageRows) byStage[row.stage] = row.n;

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
  /** The rule's full desired category set (global catalog); diffed against the current links. */
  categories?: string[];
  /** The rule's full desired stage set (global catalog); replaces the current links. */
  stages?: string[];
  /** Move the rule one step earlier/later in the global execution order. */
  move?: "up" | "down";
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

/** The rule's currently-linked category slugs. */
function currentCategories(db: Db, slug: string): string[] {
  return (
    db
      .prepare(
        `SELECT rc.category AS category
           FROM rule_categories rc
           JOIN rules r ON r.id = rc.rule_id
          WHERE r.slug = ?`,
      )
      .all(slug) as { category: string }[]
  ).map((r) => r.category);
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
  if (patch.categories !== undefined) {
    const current = new Set(currentCategories(db, slug));
    const desired = new Set(patch.categories);
    const addCategories = [...desired].filter((c) => !current.has(c));
    const removeCategories = [...current].filter((c) => !desired.has(c));
    if (addCategories.length > 0 || removeCategories.length > 0) {
      configureRule(db, slug, { addCategories, removeCategories });
    }
  }
  if (patch.stages !== undefined) {
    configureRule(db, slug, { setStages: patch.stages });
  }
  if (patch.move !== undefined) {
    reorderRule(db, slug, patch.move);
  }
  const view = listRules(db).find((r) => r.slug === slug);
  if (!view) throw new Error(`unknown rule: ${slug}`);
  return view;
}

/** POST /api/seed — populate the registry from the bundled rule set. */
export function seed(db: Db): SeedSummary {
  return seedRules(db, RULES);
}

// --- projects -------------------------------------------------------------
// Projects overlay the global catalog with their own per-rule enabled flag and
// language set. listProjectRules returns the same RuleView shape the panel
// already consumes, so panelExt only swaps the URL it reads from.

export interface ProjectView {
  id: number;
  slug: string;
  name: string;
  description: string | null;
  files: string[];
  directories: string[];
  protected: string[];
  isDefault: boolean;
}

function parsePaths(json: string | null): string[] {
  return json ? (JSON.parse(json) as string[]) : [];
}

function toProjectView(row: ProjectRow): ProjectView {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    files: parsePaths(row.files),
    directories: parsePaths(row.directories),
    protected: parsePaths(row.protected),
    isDefault: row.is_default === 1,
  };
}

/** GET /api/projects — every project, the default first. */
export function listProjects(db: Db): ProjectView[] {
  return listProjectRows(db).map(toProjectView);
}

export interface ProjectPatch {
  name?: string;
  description?: string;
  files?: string[];
  directories?: string[];
  protected?: string[];
}

/** POST /api/projects — create a project, snapshotting the global rule config. */
export function createProject(db: Db, body: ProjectPatch): ProjectView {
  const name = (body.name ?? "").trim();
  if (!name) throw new Error("name is required");
  return toProjectView(
    addProject(db, {
      name,
      description: body.description,
      files: body.files,
      directories: body.directories,
      protected: body.protected,
    }),
  );
}

/** PATCH /api/projects/:id — edit name/description/paths. */
export function updateProject(
  db: Db,
  id: number,
  body: ProjectPatch,
): ProjectView {
  return toProjectView(configureProject(db, id, body));
}

/** GET /api/projects/:id/rules — every rule with this project's enabled + languages. */
export function listProjectRules(db: Db, projectId: number): RuleView[] {
  getProject(db, projectId);
  syncProjectRules(db, projectId);

  const enabledBySlug = new Map<string, number>();
  const configBySlug = new Map<string, string | null>();
  for (const row of db
    .prepare(
      `SELECT r.slug AS slug, pr.enabled AS enabled, pr.config_json AS configJson
         FROM project_rules pr
         JOIN rules r ON r.id = pr.rule_id
        WHERE pr.project_id = ?`,
    )
    .all(projectId) as {
    slug: string;
    enabled: number;
    configJson: string | null;
  }[]) {
    enabledBySlug.set(row.slug, row.enabled);
    configBySlug.set(row.slug, row.configJson);
  }

  // Project action bindings: a rule with any row here fully replaces the
  // global bindings; a rule with none inherits them.
  const actionsBySlug = new Map<
    string,
    { environment: string | null; type: string; delayMs: number | null }[]
  >();
  for (const row of db
    .prepare(
      `SELECT r.slug AS slug, e.slug AS environment, at.slug AS type, pra.delay_ms AS delayMs
         FROM project_rule_actions pra
         JOIN rules r ON r.id = pra.rule_id
         JOIN action_types at ON at.id = pra.action_type_id
         LEFT JOIN environments e ON e.id = pra.environment_id
        WHERE pra.project_id = ?`,
    )
    .all(projectId) as {
    slug: string;
    environment: string | null;
    type: string;
    delayMs: number | null;
  }[]) {
    const list = actionsBySlug.get(row.slug) ?? [];
    list.push({
      environment: row.environment,
      type: row.type,
      delayMs: row.delayMs,
    });
    actionsBySlug.set(row.slug, list);
  }

  const langsBySlug = new Map<string, string[]>();
  for (const row of db
    .prepare(
      `SELECT r.slug AS slug, l.slug AS lang
         FROM project_rule_languages prl
         JOIN rules r ON r.id = prl.rule_id
         JOIN languages l ON l.id = prl.language_id
        WHERE prl.project_id = ?
        ORDER BY l.slug`,
    )
    .all(projectId) as { slug: string; lang: string }[]) {
    const list = langsBySlug.get(row.slug) ?? [];
    list.push(row.lang);
    langsBySlug.set(row.slug, list);
  }

  // syncProjectRules guarantees a project_rules row per rule, so a missing map
  // entry reads as disabled rather than needing an unreachable fallback branch.
  return listRules(db).map((rule) => {
    const languages = langsBySlug.get(rule.slug) ?? [];
    const configJson = configBySlug.get(rule.slug);
    const projectActions = actionsBySlug.get(rule.slug);
    const def = projectActions?.find((a) => a.environment === null);
    return {
      ...rule,
      enabled: enabledBySlug.get(rule.slug) === 1,
      languages,
      languageIndependent: languages.length === 0,
      config: configJson ? parseConfig(configJson) : rule.config,
      defaultAction: projectActions
        ? def
          ? { type: def.type, delayMs: def.delayMs }
          : null
        : rule.defaultAction,
      envActions: projectActions
        ? projectActions
            .filter((a) => a.environment !== null)
            .map((a) => ({
              environment: a.environment as string,
              type: a.type,
            }))
        : rule.envActions,
    };
  });
}

export interface ProjectRulePatch {
  enabled?: boolean;
  languages?: string[];
  /** This project's config override; null clears it (inherit the global config). */
  config?: Record<string, unknown> | null;
  setAction?: { type: string; environment?: string; delayMs?: number | null };
  removeAction?: string;
}

/** PATCH /api/projects/:id/rules/:slug — set this project's config for a rule. */
export function patchProjectRule(
  db: Db,
  projectId: number,
  slug: string,
  patch: ProjectRulePatch,
): RuleView {
  setProjectRule(db, projectId, slug, {
    enabled: patch.enabled,
    languages: patch.languages,
    config:
      patch.config === undefined
        ? undefined
        : patch.config === null
          ? null
          : JSON.stringify(patch.config),
    setAction: patch.setAction
      ? {
          type: patch.setAction.type,
          environment: patch.setAction.environment ?? null,
          delayMs: patch.setAction.delayMs ?? null,
        }
      : undefined,
    removeAction: patch.removeAction,
  });
  // setProjectRule validated the slug, so the rule is always in the list.
  return listProjectRules(db, projectId).find((r) => r.slug === slug)!;
}

/** POST /api/action-types — add (or rename) an action type. */
export function addActionType(
  db: Db,
  body: { slug?: string; name?: string; add?: boolean },
): { slug: string; name: string } {
  const slug = (body.slug ?? "").trim();
  if (!slug) throw new Error("slug is required");
  return configureActionType(db, slug, {
    add: body.add ?? true,
    name: body.name,
  });
}
