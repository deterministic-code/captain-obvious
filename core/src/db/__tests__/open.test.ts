import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { LANGUAGES } from "../../rules/languages.js";
import { openDb, resolveDbPath, type Db } from "../open.js";

describe("resolveDbPath", () => {
  // vitest runs with CAPTAIN_OBVIOUS_DB unset, so each case owns the var and
  // clears it afterwards — an unconditional delete, no branch to restore.
  afterEach(() => {
    delete process.env.CAPTAIN_OBVIOUS_DB;
  });

  it("passes :memory: through the --db flag untouched", () => {
    expect(resolveDbPath({ db: ":memory:" })).toBe(":memory:");
  });

  it("resolves a relative --db flag to an absolute path", () => {
    expect(resolveDbPath({ db: "data/x.db" })).toBe(resolve("data/x.db"));
  });

  it("falls back to the CAPTAIN_OBVIOUS_DB env var", () => {
    delete process.env.CAPTAIN_OBVIOUS_DB;
    process.env.CAPTAIN_OBVIOUS_DB = "env/x.db";
    expect(resolveDbPath()).toBe(resolve("env/x.db"));
  });

  it("passes :memory: through the env var untouched", () => {
    process.env.CAPTAIN_OBVIOUS_DB = ":memory:";
    expect(resolveDbPath()).toBe(":memory:");
  });

  it("resolves to the repo's local mode dir when nothing is set", () => {
    delete process.env.CAPTAIN_OBVIOUS_DB;
    // vitest's cwd is the repo root, which owns a captain-obvious.config.json.
    expect(resolveDbPath()).toMatch(/\.captain-obvious[/\\]captain-obvious\.db$/);
  });

  it("falls back to the package-local default outside any repo", () => {
    delete process.env.CAPTAIN_OBVIOUS_DB;
    const outside = mkdtempSync(join(tmpdir(), "co-norepo-"));
    const cwd = process.cwd();
    try {
      process.chdir(outside);
      expect(resolveDbPath()).toMatch(/data[/\\]captain-obvious\.db$/);
    } finally {
      process.chdir(cwd);
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it("does not inherit an ambient CAPTAIN_OBVIOUS_DB from the runner", () => {
    // Guards the unconditional delete in afterEach: if the runner ever set this,
    // these cases would leak/clobber it. Fail loudly instead.
    expect(process.env.CAPTAIN_OBVIOUS_DB).toBeUndefined();
  });
});

describe("openDb against a real file", () => {
  let dir: string;
  let db: Db;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "captain-obvious-"));
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("creates missing parent dirs, applies the schema, and seeds lookups", () => {
    db = openDb(join(dir, "nested", "registry.db"));
    const envs = db
      .prepare("SELECT slug FROM environments ORDER BY slug")
      .all() as { slug: string }[];
    expect(envs.map((r) => r.slug)).toEqual(["claude", "cursor", "github"]);
  });

  it("seeds the full language catalog with is_supported flags", () => {
    db = openDb(join(dir, "registry.db"));
    const rows = db
      .prepare("SELECT slug, extensions, is_supported FROM languages")
      .all() as { slug: string; extensions: string; is_supported: number }[];
    expect(rows).toHaveLength(LANGUAGES.length);
    const bySlug = new Map(rows.map((r) => [r.slug, r]));
    expect(bySlug.get("csharp")?.is_supported).toBe(1);
    expect(bySlug.get("typescript")?.is_supported).toBe(1);
    expect(bySlug.get("python")?.is_supported).toBe(0);
    expect(JSON.parse(bySlug.get("typescript")!.extensions)).toEqual([
      "ts",
      "tsx",
    ]);
  });

  it("migrates a pre-is_supported DB, then upserts the catalog onto it", () => {
    const file = join(dir, "old.db");
    const raw = new Database(file);
    raw.exec(
      `CREATE TABLE languages (
         id INTEGER PRIMARY KEY, slug TEXT NOT NULL UNIQUE,
         name TEXT NOT NULL, extensions TEXT
       ) STRICT`,
    );
    raw
      .prepare("INSERT INTO languages (slug, name) VALUES (?, ?)")
      .run("typescript", "stale name");
    raw.close();

    db = openDb(file);
    const cols = db.prepare("PRAGMA table_info(languages)").all() as {
      name: string;
    }[];
    expect(cols.some((c) => c.name === "is_supported")).toBe(true);
    const ts = db
      .prepare("SELECT name, is_supported FROM languages WHERE slug = ?")
      .get("typescript") as { name: string; is_supported: number };
    expect(ts).toEqual({ name: "TypeScript", is_supported: 1 });
  });

  it("migrates a pre-protected projects table by adding the column", () => {
    const file = join(dir, "old-projects.db");
    const raw = new Database(file);
    raw.exec(
      `CREATE TABLE projects (
         id INTEGER PRIMARY KEY, slug TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
         description TEXT, files TEXT, directories TEXT,
         is_default INTEGER NOT NULL DEFAULT 0
       ) STRICT`,
    );
    raw.close();

    db = openDb(file);
    const cols = db.prepare("PRAGMA table_info(projects)").all() as {
      name: string;
    }[];
    expect(cols.some((c) => c.name === "protected")).toBe(true);
  });
});
