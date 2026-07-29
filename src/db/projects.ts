import { logEvent } from "./audit.js";
import { isUniqueViolation } from "./languages.js";
import { requireLanguageId, requireRule } from "./lookups.js";
import type { Db } from "./open.js";
import type {
  AddProjectOpts,
  ConfigureProjectOpts,
  ProjectRow,
  SetProjectRuleOpts,
} from "./types.js";

/** Kebab-case a project name into a slug. Throws when nothing slug-able remains. */
function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!slug) throw new Error(`project name has no slug-able characters: ${name}`);
  return slug;
}

function pathsJson(paths: string[] | undefined): string | null {
  return paths && paths.length > 0 ? JSON.stringify(paths) : null;
}

/**
 * Backfill this project's per-rule config: any rule missing a `project_rules`
 * row gets one (enabled copied from the rule's global flag) plus a copy of the
 * rule's global language set. Idempotent; run on create and on every read so
 * rules seeded after the project still appear. Runs inside a caller transaction.
 */
function syncProjectRulesTx(db: Db, projectId: number): void {
  const missing = db
    .prepare(
      `SELECT r.id AS id, r.enabled AS enabled
         FROM rules r
        WHERE NOT EXISTS (
          SELECT 1 FROM project_rules pr
           WHERE pr.project_id = ? AND pr.rule_id = r.id
        )`,
    )
    .all(projectId) as { id: number; enabled: number }[];
  const addRule = db.prepare(
    "INSERT INTO project_rules (project_id, rule_id, enabled) VALUES (?, ?, ?)",
  );
  const copyLangs = db.prepare(
    `INSERT INTO project_rule_languages (project_id, rule_id, language_id)
     SELECT ?, rule_id, language_id FROM rule_languages WHERE rule_id = ?`,
  );
  for (const r of missing) {
    addRule.run(projectId, r.id, r.enabled);
    copyLangs.run(projectId, r.id);
  }
}

export function syncProjectRules(db: Db, projectId: number): void {
  db.transaction(() => syncProjectRulesTx(db, projectId))();
}

interface InsertProjectFields {
  name: string;
  description?: string;
  files?: string[];
  directories?: string[];
  isDefault: boolean;
}

/** Insert one project row and snapshot the current global rule config into it. */
function insertProject(db: Db, fields: InsertProjectFields): ProjectRow {
  const { name, description, files, directories, isDefault } = fields;
  if (!name) throw new Error("add-project requires a name");
  const slug = slugify(name);

  const create = db.transaction((): ProjectRow => {
    let id: number | bigint;
    try {
      id = db
        .prepare(
          "INSERT INTO projects (slug, name, description, files, directories, is_default) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .run(
          slug,
          name,
          description ?? null,
          pathsJson(files),
          pathsJson(directories),
          isDefault ? 1 : 0,
        ).lastInsertRowid;
    } catch (err) {
      if (isUniqueViolation(err)) throw new Error(`project already exists: ${slug}`);
      throw err;
    }
    syncProjectRulesTx(db, Number(id));
    return db.prepare("SELECT * FROM projects WHERE id = ?").get(id) as ProjectRow;
  });
  return create();
}

/** Create a user project, snapshotting the global rule config into it. */
export function addProject(db: Db, opts: AddProjectOpts): ProjectRow {
  const row = insertProject(db, { ...opts, isDefault: false });
  logEvent("project.added", `added project ${row.slug}`);
  return row;
}

/** Every project, the default first. */
export function listProjects(db: Db): ProjectRow[] {
  return db
    .prepare("SELECT * FROM projects ORDER BY is_default DESC, name")
    .all() as ProjectRow[];
}

export function getProject(db: Db, id: number): ProjectRow {
  const row = db.prepare("SELECT * FROM projects WHERE id = ?").get(id) as
    | ProjectRow
    | undefined;
  if (row === undefined) throw new Error(`unknown project: ${id}`);
  return row;
}

/** Update a project's name/description/paths (each field replaced wholesale). */
export function configureProject(
  db: Db,
  id: number,
  opts: ConfigureProjectOpts,
): ProjectRow {
  const apply = db.transaction((): ProjectRow => {
    const existing = db
      .prepare("SELECT id FROM projects WHERE id = ?")
      .get(id) as { id: number } | undefined;
    if (existing === undefined) throw new Error(`unknown project: ${id}`);
    if (opts.name !== undefined) {
      db.prepare("UPDATE projects SET name = ?, slug = ? WHERE id = ?").run(
        opts.name,
        slugify(opts.name),
        id,
      );
    }
    if (opts.description !== undefined) {
      db.prepare("UPDATE projects SET description = ? WHERE id = ?").run(
        opts.description,
        id,
      );
    }
    if (opts.files !== undefined) {
      db.prepare("UPDATE projects SET files = ? WHERE id = ?").run(
        pathsJson(opts.files),
        id,
      );
    }
    if (opts.directories !== undefined) {
      db.prepare("UPDATE projects SET directories = ? WHERE id = ?").run(
        pathsJson(opts.directories),
        id,
      );
    }
    return db.prepare("SELECT * FROM projects WHERE id = ?").get(id) as ProjectRow;
  });

  let row: ProjectRow;
  try {
    row = apply();
  } catch (err) {
    if (isUniqueViolation(err)) throw new Error("another project already uses that name");
    throw err;
  }
  logEvent("project.configured", `updated project ${row.slug}`);
  return row;
}

/**
 * Project-scoped equivalent of patchRule: set a rule's enabled flag and/or
 * rewrite its language set for one project. Backfills first so the row exists.
 */
export function setProjectRule(
  db: Db,
  projectId: number,
  ruleSlug: string,
  opts: SetProjectRuleOpts,
): void {
  getProject(db, projectId);
  const rule = requireRule(db, ruleSlug);
  const languageIds =
    opts.languages !== undefined
      ? opts.languages.map((s) => requireLanguageId(db, s))
      : undefined;

  const apply = db.transaction(() => {
    syncProjectRulesTx(db, projectId);
    if (opts.enabled !== undefined) {
      db.prepare(
        "UPDATE project_rules SET enabled = ? WHERE project_id = ? AND rule_id = ?",
      ).run(opts.enabled ? 1 : 0, projectId, rule.id);
    }
    if (languageIds !== undefined) {
      db.prepare(
        "DELETE FROM project_rule_languages WHERE project_id = ? AND rule_id = ?",
      ).run(projectId, rule.id);
      const link = db.prepare(
        "INSERT INTO project_rule_languages (project_id, rule_id, language_id) VALUES (?, ?, ?)",
      );
      for (const id of languageIds) link.run(projectId, rule.id, id);
    }
  });
  apply();

  if (opts.enabled === true) {
    logEvent("project.rule.enabled", `enabled ${ruleSlug} in project ${projectId}`);
  }
  if (opts.enabled === false) {
    logEvent("project.rule.disabled", `disabled ${ruleSlug} in project ${projectId}`);
  }
  if (opts.languages !== undefined) {
    logEvent(
      "project.rule.configured",
      `updated languages for ${ruleSlug} in project ${projectId}`,
    );
  }
}

/**
 * Ensure the default project (is_default = 1) exists — the repo the hook is
 * installed in. `name` is resolved by the caller (server layer) so this stays
 * free of filesystem concerns. Idempotent: re-syncs an existing default instead.
 */
export function ensureDefaultProject(db: Db, root: string, name: string): ProjectRow {
  const existing = db
    .prepare("SELECT * FROM projects WHERE is_default = 1")
    .get() as ProjectRow | undefined;
  if (existing) {
    syncProjectRules(db, existing.id);
    return existing;
  }
  const row = insertProject(db, { name, directories: [root], isDefault: true });
  logEvent("project.added", `added default project ${row.slug}`);
  return row;
}
