-- captain-obvious registry schema.
-- Canonical catalog of languages, environments, hooks, rules, rule->action
-- bindings, and fixes. Applied idempotently on every openDb() via db.exec():
-- every statement is CREATE ... IF NOT EXISTS so re-opening an existing DB is a
-- no-op. Lookup rows (environments, action_types) are seeded separately in
-- open.ts with INSERT OR IGNORE.

PRAGMA foreign_keys = ON;

-- Lookups -----------------------------------------------------------------

CREATE TABLE IF NOT EXISTS languages (
  id         INTEGER PRIMARY KEY,
  slug       TEXT NOT NULL UNIQUE,        -- 'typescript'
  name       TEXT NOT NULL,               -- 'TypeScript'
  extensions TEXT                         -- JSON array: ["ts","tsx"] (optional)
) STRICT;

CREATE TABLE IF NOT EXISTS environments (
  id   INTEGER PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,              -- 'claude' | 'cursor' | 'github'
  name TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS action_types (
  id   INTEGER PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,              -- 'warn' | 'halt' | 'delay_halt'
  name TEXT NOT NULL
) STRICT;

-- Hooks: integration points, one per environment --------------------------

CREATE TABLE IF NOT EXISTS hooks (
  id             INTEGER PRIMARY KEY,
  environment_id INTEGER NOT NULL REFERENCES environments(id) ON DELETE CASCADE,
  slug           TEXT NOT NULL,           -- 'dispatch-guard', 'pre-commit'
  event          TEXT,                    -- 'PreToolUse','Stop','SessionStart','pre-commit'
  description    TEXT,
  enabled        INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  UNIQUE (environment_id, slug)
) STRICT;

-- Rules: the checks -------------------------------------------------------

CREATE TABLE IF NOT EXISTS rules (
  id          INTEGER PRIMARY KEY,
  slug        TEXT NOT NULL UNIQUE,       -- 'lint-dup-structural'
  name        TEXT NOT NULL,
  category    TEXT,                       -- 'duplication','solid','size','hygiene'
  description TEXT,
  config_json TEXT,                       -- thresholds: {"maxLines":300}
  enabled     INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1))
) STRICT;

-- Rule <-> Language (many-to-many) ----------------------------------------

CREATE TABLE IF NOT EXISTS rule_languages (
  rule_id     INTEGER NOT NULL REFERENCES rules(id)     ON DELETE CASCADE,
  language_id INTEGER NOT NULL REFERENCES languages(id) ON DELETE CASCADE,
  PRIMARY KEY (rule_id, language_id)
) STRICT;

-- Hook <-> Rule (which rules run under which hook) ------------------------

CREATE TABLE IF NOT EXISTS hook_rules (
  hook_id INTEGER NOT NULL REFERENCES hooks(id) ON DELETE CASCADE,
  rule_id INTEGER NOT NULL REFERENCES rules(id) ON DELETE CASCADE,
  PRIMARY KEY (hook_id, rule_id)
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
  kind        TEXT NOT NULL CHECK (kind IN ('inferred', 'script')),
  language_id INTEGER REFERENCES languages(id),   -- script may be lang-specific
  script_path TEXT,
  script_body TEXT,
  description TEXT,
  CHECK (kind = 'inferred' OR script_path IS NOT NULL OR script_body IS NOT NULL)
) STRICT;

CREATE INDEX IF NOT EXISTS idx_hooks_env       ON hooks(environment_id);
CREATE INDEX IF NOT EXISTS idx_hook_rules_rule ON hook_rules(rule_id);
CREATE INDEX IF NOT EXISTS idx_rule_actions    ON rule_actions(rule_id);
CREATE INDEX IF NOT EXISTS idx_fixes_rule      ON fixes(rule_id);
