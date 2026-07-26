import { mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

/** better-sqlite3 database handle. */
export type Db = Database.Database;

/** Package root: two levels up from this module (src/db or dist/db). */
const pkgRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

const SCHEMA_PATH = resolve(pkgRoot, "db", "schema.sql");
const DEFAULT_DB_PATH = resolve(pkgRoot, "data", "captain-obvious.db");

/** Seed rows for the fixed lookup tables. */
const ENVIRONMENTS: ReadonlyArray<readonly [string, string]> = [
  ["claude", "Claude Code"],
  ["cursor", "Cursor"],
  ["github", "GitHub"],
];

const ACTION_TYPES: ReadonlyArray<readonly [string, string]> = [
  ["warn", "Warn"],
  ["halt", "Halt"],
  ["delay_halt", "Delayed halt"],
];

export interface DbPathOpts {
  /** Explicit `--db <path>` override. */
  db?: string;
}

/**
 * Resolve which DB file to open. Precedence: explicit `--db` flag, then the
 * CAPTAIN_OBVIOUS_DB env var, then the package-local default. Tests point this
 * at a temp file or ":memory:".
 */
export function resolveDbPath(opts: DbPathOpts = {}): string {
  if (opts.db) return opts.db === ":memory:" ? opts.db : resolve(opts.db);
  const fromEnv = process.env.CAPTAIN_OBVIOUS_DB;
  if (fromEnv) return fromEnv === ":memory:" ? fromEnv : resolve(fromEnv);
  return DEFAULT_DB_PATH;
}

/**
 * Open (creating if missing) the registry DB, apply the schema idempotently,
 * enable foreign keys, and seed the fixed lookup tables. Safe to call on an
 * existing DB — schema uses IF NOT EXISTS and seeds use INSERT OR IGNORE.
 */
export function openDb(dbPath: string): Db {
  if (dbPath !== ":memory:") {
    mkdirSync(dirname(dbPath), { recursive: true });
  }
  const db = new Database(dbPath);
  db.pragma("foreign_keys = ON");
  db.exec(readFileSync(SCHEMA_PATH, "utf8"));
  seedLookups(db);
  return db;
}

function seedLookups(db: Db): void {
  const env = db.prepare(
    "INSERT OR IGNORE INTO environments (slug, name) VALUES (?, ?)",
  );
  const action = db.prepare(
    "INSERT OR IGNORE INTO action_types (slug, name) VALUES (?, ?)",
  );
  const seed = db.transaction(() => {
    for (const [slug, name] of ENVIRONMENTS) env.run(slug, name);
    for (const [slug, name] of ACTION_TYPES) action.run(slug, name);
  });
  seed();
}
