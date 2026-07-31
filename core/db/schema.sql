-- captain-obvious registry schema.
-- Canonical catalog of languages, environments, hooks, rules, rule->action
-- bindings, and fixes. Applied idempotently on every openDb() via db.exec():
-- every statement is CREATE ... IF NOT EXISTS so re-opening an existing DB is a
-- no-op. Lookup rows (environments, action_types) are seeded separately in
-- open.ts with INSERT OR IGNORE.

PRAGMA foreign_keys = ON;

-- Lookups -----------------------------------------------------------------

CREATE TABLE IF NOT EXISTS languages (
  id           INTEGER PRIMARY KEY,
  slug         TEXT NOT NULL UNIQUE,      -- 'typescript'
  name         TEXT NOT NULL,             -- 'TypeScript'
  extensions   TEXT,                      -- JSON array: ["ts","tsx"] (optional)
  is_supported INTEGER NOT NULL DEFAULT 0 -- 1 when the bundled rule set can police it today
) STRICT;

CREATE TABLE IF NOT EXISTS environments (
  id   INTEGER PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,              -- 'claude' | 'cursor' | 'github'
  name TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS action_types (
  id   INTEGER PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,              -- warn | halt | delay_halt | fix | fix_and_warn | fix_and_halt
  name TEXT NOT NULL
) STRICT;

-- Rules: the checks -------------------------------------------------------

CREATE TABLE IF NOT EXISTS rules (
  id          INTEGER PRIMARY KEY,
  slug        TEXT NOT NULL UNIQUE,       -- 'lint-dup-structural'
  name        TEXT NOT NULL,
  category    TEXT,                       -- 'duplication','solid','size','hygiene'
  description TEXT,
  config_json TEXT,                       -- thresholds: {"maxLines":300}
  control_json TEXT,                      -- serialized ControlSpec (settings dialog), or null
  deps_json   TEXT,                       -- serialized RuleDependency[] (external tools), or null
  enabled     INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  sort_index  INTEGER NOT NULL DEFAULT 100 -- execution/display order, ascending; ties break by slug
) STRICT;

-- Rule <-> Language (many-to-many) ----------------------------------------

CREATE TABLE IF NOT EXISTS rule_languages (
  rule_id     INTEGER NOT NULL REFERENCES rules(id)     ON DELETE CASCADE,
  language_id INTEGER NOT NULL REFERENCES languages(id) ON DELETE CASCADE,
  PRIMARY KEY (rule_id, language_id)
) STRICT;

-- Rule <-> Category (many-to-many) ----------------------------------------
-- A rule carries one primary category (rules.category, kept for the prebuilt
-- panel) plus any number of additional ones here. The primary is also stored as
-- a row, so this table holds the rule's full category set. Free text, mirroring
-- rules.category (no category lookup table).

CREATE TABLE IF NOT EXISTS rule_categories (
  rule_id  INTEGER NOT NULL REFERENCES rules(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  PRIMARY KEY (rule_id, category)
) STRICT;

-- Rule <-> Stage (many-to-many) -------------------------------------------
-- Which git/tool stages a rule runs at (pre-commit, pre-push, claude-tool,
-- server). The source of truth the dispatcher reads at runtime, so toggling a
-- rule's stages in the control panel changes what runs with no reinstall.
-- Seeded from RuleMeta.stages. Free text validated against the canonical stage
-- list (src/rules/stages.ts); no stage lookup table.

CREATE TABLE IF NOT EXISTS rule_stages (
  rule_id INTEGER NOT NULL REFERENCES rules(id) ON DELETE CASCADE,
  stage   TEXT NOT NULL,
  PRIMARY KEY (rule_id, stage)
) STRICT;

-- What a rule does when it fires ------------------------------------------
-- environment_id NULL = default binding for all envs; a row with an env
-- overrides the default for that env.

CREATE TABLE IF NOT EXISTS rule_actions (
  id             INTEGER PRIMARY KEY,
  rule_id        INTEGER NOT NULL REFERENCES rules(id) ON DELETE CASCADE,
  environment_id INTEGER REFERENCES environments(id) ON DELETE CASCADE,
  action_type_id INTEGER NOT NULL REFERENCES action_types(id),
  delay_ms       INTEGER,                 -- delay in ms, for 'delay_halt' bindings
  UNIQUE (rule_id, environment_id)
) STRICT;

-- Fixes: inferred or a custom script --------------------------------------

CREATE TABLE IF NOT EXISTS fixes (
  id          INTEGER PRIMARY KEY,
  rule_id     INTEGER NOT NULL REFERENCES rules(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN ('inferred', 'script', 'output')),
  language_id INTEGER REFERENCES languages(id),   -- script may be lang-specific
  script_path TEXT,
  script_body TEXT,
  description TEXT,
  -- Only 'script' actions need a script; 'inferred' (model-driven) and 'output'
  -- (report-only) actions carry none.
  CHECK (kind IN ('inferred', 'output') OR script_path IS NOT NULL OR script_body IS NOT NULL)
) STRICT;

-- Projects: a named scope (files/dirs) with its own per-rule config -----------
-- The registry catalog (rules, languages) is global; a project overlays it with
-- its own enabled flag and language set per rule (project_rules /
-- project_rule_languages). Exactly one project has is_default = 1 — the repo the
-- hook is installed in.

CREATE TABLE IF NOT EXISTS projects (
  id          INTEGER PRIMARY KEY,
  slug        TEXT NOT NULL UNIQUE,       -- kebab of name
  name        TEXT NOT NULL,
  description TEXT,
  files       TEXT,                       -- JSON array of absolute paths (optional)
  directories TEXT,                       -- JSON array of absolute paths (optional)
  protected   TEXT,                       -- JSON array of glob patterns (optional)
  is_default  INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1))
) STRICT;

-- Per-project enabled flag for a rule. Seeded from the rule's global `enabled`
-- when a project is created, and backfilled for rules added later (syncProjectRules).
-- config_json overrides the rule's global config for this project (NULL = inherit).
CREATE TABLE IF NOT EXISTS project_rules (
  project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  rule_id     INTEGER NOT NULL REFERENCES rules(id)    ON DELETE CASCADE,
  enabled     INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  config_json TEXT,
  PRIMARY KEY (project_id, rule_id)
) STRICT;

-- Per-project language set for a rule (mirrors rule_languages, scoped to a project).
CREATE TABLE IF NOT EXISTS project_rule_languages (
  project_id  INTEGER NOT NULL REFERENCES projects(id)  ON DELETE CASCADE,
  rule_id     INTEGER NOT NULL REFERENCES rules(id)     ON DELETE CASCADE,
  language_id INTEGER NOT NULL REFERENCES languages(id) ON DELETE CASCADE,
  PRIMARY KEY (project_id, rule_id, language_id)
) STRICT;

-- Per-project action bindings for a rule (mirrors rule_actions, scoped to a
-- project). A rule with zero rows here inherits the global bindings; any row
-- means the project's bindings fully replace the global set for that rule.
-- environment_id NULL = default binding for all envs.
CREATE TABLE IF NOT EXISTS project_rule_actions (
  id             INTEGER PRIMARY KEY,
  project_id     INTEGER NOT NULL REFERENCES projects(id)      ON DELETE CASCADE,
  rule_id        INTEGER NOT NULL REFERENCES rules(id)         ON DELETE CASCADE,
  environment_id INTEGER REFERENCES environments(id)           ON DELETE CASCADE,
  action_type_id INTEGER NOT NULL REFERENCES action_types(id),
  delay_ms       INTEGER,
  UNIQUE (project_id, rule_id, environment_id)
) STRICT;

CREATE INDEX IF NOT EXISTS idx_rule_categories  ON rule_categories(rule_id);
CREATE INDEX IF NOT EXISTS idx_rule_stages      ON rule_stages(rule_id);
CREATE INDEX IF NOT EXISTS idx_rule_actions    ON rule_actions(rule_id);
CREATE INDEX IF NOT EXISTS idx_fixes_rule      ON fixes(rule_id);
CREATE INDEX IF NOT EXISTS idx_project_rules_project ON project_rules(project_id);
CREATE INDEX IF NOT EXISTS idx_prl_project           ON project_rule_languages(project_id);
CREATE INDEX IF NOT EXISTS idx_pra_project_rule      ON project_rule_actions(project_id, rule_id);
