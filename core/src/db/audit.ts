import { mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { resolveModeLocation } from "./location.js";
import type { Db } from "./open.js";

/** Package root: two levels up from this module (src/db or dist/db). */
const pkgRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

const AUDIT_SCHEMA_PATH = resolve(pkgRoot, "db", "audit-schema.sql");
const DEFAULT_AUDIT_DB_PATH = resolve(pkgRoot, "data", "audit-log.db");

export interface AuditDbPathOpts {
  /** Explicit `--audit-db <path>` override. */
  db?: string;
}

/**
 * Resolve the audit-log DB path. Precedence: explicit `--audit-db`, then the
 * CAPTAIN_OBVIOUS_AUDIT_DB env var, then the local/global mode directory, then the
 * package-local default. Kept separate from the registry path so the audit file
 * can be pointed elsewhere or deleted without affecting the catalog.
 */
export function resolveAuditDbPath(opts: AuditDbPathOpts = {}): string {
  if (opts.db) return opts.db === ":memory:" ? opts.db : resolve(opts.db);
  const fromEnv = process.env.CAPTAIN_OBVIOUS_AUDIT_DB;
  if (fromEnv) return fromEnv === ":memory:" ? fromEnv : resolve(fromEnv);
  const loc = resolveModeLocation();
  if (loc) return resolve(loc.dir, "audit-log.db");
  return DEFAULT_AUDIT_DB_PATH;
}

/**
 * The columns each audit writer/reader depends on. Asserted at open so a DB whose
 * schema drifted — e.g. a branch that renamed `hook_runs.duration` — fails with one
 * clear error here instead of a cryptic "no column named X" on the first INSERT,
 * which the fail-open guard hooks would otherwise swallow into silence.
 */
const REQUIRED_AUDIT_COLUMNS: Record<string, readonly string[]> = {
  hook_runs: ["slug", "stage", "status", "started", "duration", "found", "fixed"],
  logs: ["log_type", "message", "created"],
};

/** The column names of `table`, as SQLite reports them. */
function tableColumns(db: Db, table: string): Set<string> {
  return new Set(
    (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map(
      (c) => c.name,
    ),
  );
}

/** Throw if any audit table lacks a column its writer uses — i.e. the file drifted. */
function assertAuditShape(db: Db, dbPath: string): void {
  for (const [table, required] of Object.entries(REQUIRED_AUDIT_COLUMNS)) {
    const cols = tableColumns(db, table);
    const missing = required.filter((c) => !cols.has(c));
    if (missing.length > 0) {
      throw new Error(
        `audit DB ${dbPath}: table ${table} is missing column(s) ${missing.join(", ")} — ` +
          "its schema drifted from this build. The audit log is disposable; delete it to rebuild.",
      );
    }
  }
}

/** Open (creating if missing) the audit-log DB and apply its schema idempotently. */
export function openAuditDb(dbPath: string): Db {
  if (dbPath !== ":memory:") {
    mkdirSync(dirname(dbPath), { recursive: true });
  }
  const db = new Database(dbPath);
  db.exec(readFileSync(AUDIT_SCHEMA_PATH, "utf8"));
  migrateHookRuns(db);
  assertAuditShape(db, dbPath);
  return db;
}

/**
 * Backfill the per-run result columns onto a hook_runs table that predates them.
 * A fresh DB already carries `found`/`fixed` from the schema, so both checks are
 * a no-op; an audit file written before this feature gets them added so opening
 * it never fails on the count SELECT. Idempotent (guarded by table_info).
 */
export function migrateHookRuns(db: Db): void {
  const cols = tableColumns(db, "hook_runs");
  if (!cols.has("found")) {
    db.exec("ALTER TABLE hook_runs ADD COLUMN found INTEGER");
  }
  if (!cols.has("fixed")) {
    db.exec("ALTER TABLE hook_runs ADD COLUMN fixed INTEGER");
  }
}

// The audit log is a cross-cutting sink the mutation helpers write to. It stays a
// no-op until the server or CLI points it at an open DB, so db-layer unit tests
// (which never enable it) neither create audit files nor need one wired in.
let sink: Db | undefined;

/** Point the audit logger at an open audit DB, or pass undefined to disable it. */
export function useAuditLog(db: Db | undefined): void {
  sink = db;
}

/**
 * Append one event to an explicitly-handed audit DB. The rule runner and the
 * git/Claude hooks own their audit DB directly (they run as short-lived processes
 * outside the server's module sink), so they log through this rather than the
 * sink-based logEvent.
 */
export function logEventTo(db: Db, logType: string, message: string): void {
  db.prepare("INSERT INTO logs (log_type, message) VALUES (?, ?)").run(
    logType,
    message,
  );
}

/** Record one state-change event on the module sink. No-op when the audit log is disabled. */
export function logEvent(logType: string, message: string): void {
  if (!sink) return;
  logEventTo(sink, logType, message);
}

export interface LogRow {
  message: string;
  created: string;
}

/** The most recent event of a type, or undefined when there are none (or the log is disabled). */
export function latestEvent(logType: string): LogRow | undefined {
  if (!sink) return undefined;
  return sink
    .prepare(
      "SELECT message, created FROM logs WHERE log_type = ? ORDER BY id DESC LIMIT 1",
    )
    .get(logType) as LogRow | undefined;
}

export interface LogEntry {
  logType: string;
  message: string;
  created: string;
}
export interface ListLogsOpts {
  /** Keep rows created at/after this epoch-ms instant (omit for no lower bound). */
  sinceMs?: number;
  /** Cap the number of newest rows returned (omit for no cap). */
  limit?: number;
}

/**
 * Newest-first config-activity rows. Takes an explicit db handle (not the module
 * sink) so the Activity feed reads whichever audit DB the server opened, and so
 * it stays unit-testable. `created` is 'YYYY-MM-DD HH:MM:SS' UTC — compared as a
 * lexicographically-sortable string against the same format from `sinceMs`.
 */
export function listLogs(db: Db, opts: ListLogsOpts = {}): LogEntry[] {
  const clauses: string[] = [];
  const params: (string | number)[] = [];
  if (opts.sinceMs !== undefined) {
    clauses.push("created >= ?");
    params.push(
      new Date(opts.sinceMs).toISOString().slice(0, 19).replace("T", " "),
    );
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const limit = opts.limit !== undefined ? " LIMIT ?" : "";
  if (opts.limit !== undefined) params.push(opts.limit);
  return db
    .prepare(
      `SELECT log_type AS logType, message, created FROM logs ${where} ORDER BY id DESC${limit}`,
    )
    .all(...params) as LogEntry[];
}

export interface HookRunRecord {
  slug: string;
  stage: string;
  status: "success" | "failure";
  /** Run start, epoch milliseconds. */
  startedMs: number;
  /** Run duration, milliseconds. */
  durationMs: number;
  /** Violations the check reported this run; null when it emitted no count. */
  found?: number | null;
  /** Files a fix modified this run; null when not applicable. */
  fixed?: number | null;
}

/**
 * Append one git-hook rule run. Unlike logEvent, this takes an explicit db
 * handle: the dispatcher runs as its own short-lived process (a git hook), not
 * under the server's module sink, so it opens the audit DB and writes directly.
 */
export function recordHookRun(db: Db, run: HookRunRecord): void {
  db.prepare(
    "INSERT INTO hook_runs (slug, stage, status, started, duration, found, fixed) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).run(
    run.slug,
    run.stage,
    run.status,
    run.startedMs,
    run.durationMs,
    run.found ?? null,
    run.fixed ?? null,
  );
}

export interface HookRunEntry {
  slug: string;
  stage: string;
  status: string;
  started: number;
  /** Violations the check reported, or null for runs predating result capture. */
  found: number | null;
  /** Files a fix modified, or null for runs that don't perform fixes. */
  fixed: number | null;
}

/** Newest-first git-hook runs, window-filtered on `started` (epoch ms). */
export function listHookRuns(db: Db, opts: ListLogsOpts = {}): HookRunEntry[] {
  const clauses: string[] = [];
  const params: number[] = [];
  if (opts.sinceMs !== undefined) {
    clauses.push("started >= ?");
    params.push(opts.sinceMs);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const limit = opts.limit !== undefined ? " LIMIT ?" : "";
  if (opts.limit !== undefined) params.push(opts.limit);
  return db
    .prepare(
      `SELECT slug, stage, status, started, found, fixed FROM hook_runs ${where} ORDER BY started DESC${limit}`,
    )
    .all(...params) as HookRunEntry[];
}
