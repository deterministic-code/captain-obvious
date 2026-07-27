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
