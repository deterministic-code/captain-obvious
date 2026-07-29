import { mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
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
 * CAPTAIN_OBVIOUS_AUDIT_DB env var, then the package-local default. Kept separate
 * from the registry path so the audit file can be pointed elsewhere or deleted
 * without affecting the catalog.
 */
export function resolveAuditDbPath(opts: AuditDbPathOpts = {}): string {
  if (opts.db) return opts.db === ":memory:" ? opts.db : resolve(opts.db);
  const fromEnv = process.env.CAPTAIN_OBVIOUS_AUDIT_DB;
  if (fromEnv) return fromEnv === ":memory:" ? fromEnv : resolve(fromEnv);
  return DEFAULT_AUDIT_DB_PATH;
}

/** Open (creating if missing) the audit-log DB and apply its schema idempotently. */
export function openAuditDb(dbPath: string): Db {
  if (dbPath !== ":memory:") {
    mkdirSync(dirname(dbPath), { recursive: true });
  }
  const db = new Database(dbPath);
  db.exec(readFileSync(AUDIT_SCHEMA_PATH, "utf8"));
  return db;
}

// The audit log is a cross-cutting sink the mutation helpers write to. It stays a
// no-op until the server or CLI points it at an open DB, so db-layer unit tests
// (which never enable it) neither create audit files nor need one wired in.
let sink: Db | undefined;

/** Point the audit logger at an open audit DB, or pass undefined to disable it. */
export function useAuditLog(db: Db | undefined): void {
  sink = db;
}

/** Record one state-change event. No-op when the audit log is disabled. */
export function logEvent(logType: string, message: string): void {
  if (!sink) return;
  sink
    .prepare("INSERT INTO logs (log_type, message) VALUES (?, ?)")
    .run(logType, message);
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
    params.push(new Date(opts.sinceMs).toISOString().slice(0, 19).replace("T", " "));
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
