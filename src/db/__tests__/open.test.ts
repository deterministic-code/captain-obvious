import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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

  it("uses the package-local default when nothing is set", () => {
    delete process.env.CAPTAIN_OBVIOUS_DB;
    expect(resolveDbPath()).toMatch(/data\/captain-obvious\.db$/);
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
});
