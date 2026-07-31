-- captain-obvious audit log schema.
-- A standalone DB (its own file, separate from the registry) so the whole audit
-- trail can be dropped without touching the catalog. Applied idempotently on
-- every openAuditDb() via db.exec(): CREATE ... IF NOT EXISTS, so re-opening is a
-- no-op. One row per state change (enable/disable, add/configure rule, action
-- binding, action-type edit, language add, seed).

CREATE TABLE IF NOT EXISTS logs (
  id       INTEGER PRIMARY KEY,
  log_type TEXT NOT NULL,                          -- 'rule.enabled', 'action.set', ...
  message  TEXT NOT NULL,                          -- human-readable summary
  created  TEXT NOT NULL DEFAULT (datetime('now')) -- ISO-8601 UTC, sortable
) STRICT;

CREATE INDEX IF NOT EXISTS idx_logs_created ON logs(created);

-- One row per rule run by the git-hook dispatcher (pre-commit / pre-push). The
-- external "hooker" profiler records Claude Code's own tool calls into a separate
-- profile DB; this is where captain-obvious records ITS lint dispatch, so the
-- Activity view can show rule runs the profiler never sees. `started` is epoch ms
-- (unlike the profile DB's microseconds) to match the audit log's ms convention.
CREATE TABLE IF NOT EXISTS hook_runs (
  id       INTEGER PRIMARY KEY,
  slug     TEXT    NOT NULL,   -- rule slug, e.g. 'lint-naming'
  stage    TEXT    NOT NULL,   -- 'pre-commit' | 'pre-push'
  status   TEXT    NOT NULL,   -- 'success' | 'failure'
  started  INTEGER NOT NULL,   -- epoch milliseconds
  duration INTEGER NOT NULL    -- run time in milliseconds
) STRICT;

CREATE INDEX IF NOT EXISTS idx_hook_runs_started ON hook_runs(started);
