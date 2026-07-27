-- captain-obvious audit log schema.
-- A standalone DB (its own file, separate from the registry) so the whole audit
-- trail can be dropped without touching the catalog. Applied idempotently on
-- every openAuditDb() via db.exec(): CREATE ... IF NOT EXISTS, so re-opening is a
-- no-op. One row per state change (enable/disable, add/configure rule, severity
-- binding, action-type edit, language add, seed).

CREATE TABLE IF NOT EXISTS logs (
  id       INTEGER PRIMARY KEY,
  log_type TEXT NOT NULL,                          -- 'rule.enabled', 'severity.set', ...
  message  TEXT NOT NULL,                          -- human-readable summary
  created  TEXT NOT NULL DEFAULT (datetime('now')) -- ISO-8601 UTC, sortable
) STRICT;

CREATE INDEX IF NOT EXISTS idx_logs_created ON logs(created);
