import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { configureProject, ensureDefaultProject } from "../../db/projects.js";
import { openDb } from "../../db/open.js";
import { matchProtected, readProtectedGlobs } from "../protectedPaths.js";

describe("matchProtected", () => {
  it("never matches when the glob set is empty", () => {
    expect(matchProtected("db/schema.sql", [])).toBe(false);
  });

  it("matches an exact path", () => {
    expect(matchProtected("db/schema.sql", ["db/schema.sql"])).toBe(true);
    expect(matchProtected("db/other.sql", ["db/schema.sql"])).toBe(false);
  });

  it("matches a globstar directory pattern", () => {
    expect(matchProtected("src/server/serve.ts", ["src/server/**"])).toBe(true);
    expect(matchProtected("src/db/open.ts", ["src/server/**"])).toBe(false);
  });

  it("matches dotfile roots (dot: true)", () => {
    expect(matchProtected(".github/workflows/ci.yml", [".github/**"])).toBe(
      true,
    );
  });

  it("matches when any glob in the set matches", () => {
    const globs = ["db/schema.sql", ".github/**"];
    expect(matchProtected(".github/x.yml", globs)).toBe(true);
    expect(matchProtected("README.md", globs)).toBe(false);
  });
});

describe("readProtectedGlobs", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "protected-globs-"));
    process.env.CAPTAIN_OBVIOUS_DB = join(dir, "registry.db");
  });

  afterEach(() => {
    delete process.env.CAPTAIN_OBVIOUS_DB;
    rmSync(dir, { recursive: true, force: true });
  });

  it("reads the default project's protected globs from the resolved DB", () => {
    const setup = openDb(process.env.CAPTAIN_OBVIOUS_DB as string);
    const p = ensureDefaultProject(setup, "/repo", "Repo");
    configureProject(setup, p.id, { protected: ["db/schema.sql"] });
    setup.close();

    expect(readProtectedGlobs()).toEqual(["db/schema.sql"]);
  });
});
