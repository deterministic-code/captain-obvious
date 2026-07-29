import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDb, type Db } from "../open.js";
import { addRule } from "../rules.js";
import {
  addProject,
  configureProject,
  ensureDefaultProject,
  getProject,
  listProjects,
  setProjectRule,
  syncProjectRules,
} from "../projects.js";

let db: Db;

beforeEach(() => {
  db = openDb(":memory:");
});

afterEach(() => {
  db.close();
});

/** project_rules rows for a project keyed by rule slug -> enabled. */
function projectEnabled(projectId: number): Record<string, number> {
  const rows = db
    .prepare(
      `SELECT r.slug AS slug, pr.enabled AS enabled
         FROM project_rules pr JOIN rules r ON r.id = pr.rule_id
        WHERE pr.project_id = ?`,
    )
    .all(projectId) as { slug: string; enabled: number }[];
  return Object.fromEntries(rows.map((r) => [r.slug, r.enabled]));
}

/** project_rule_languages slugs for one rule in a project. */
function projectLangs(projectId: number, ruleSlug: string): string[] {
  return (
    db
      .prepare(
        `SELECT l.slug AS slug
           FROM project_rule_languages prl
           JOIN rules r ON r.id = prl.rule_id
           JOIN languages l ON l.id = prl.language_id
          WHERE prl.project_id = ? AND r.slug = ?
          ORDER BY l.slug`,
      )
      .all(projectId, ruleSlug) as { slug: string }[]
  ).map((r) => r.slug);
}

describe("addProject", () => {
  it("inserts a project, deriving a kebab slug and JSON-encoding paths", () => {
    const row = addProject(db, {
      name: "My App",
      description: "the app",
      files: ["/a/x.ts"],
      directories: ["/a/src"],
    });
    expect(row).toMatchObject({ slug: "my-app", name: "My App", description: "the app" });
    expect(JSON.parse(row.files as string)).toEqual(["/a/x.ts"]);
    expect(JSON.parse(row.directories as string)).toEqual(["/a/src"]);
    expect(row.is_default).toBe(0);
  });

  it("stores null paths when none are given", () => {
    const row = addProject(db, { name: "Bare" });
    expect(row.files).toBeNull();
    expect(row.directories).toBeNull();
  });

  it("snapshots the global rule config (enabled + languages) into the project", () => {
    addRule(db, { slug: "lint-a", name: "A", languages: ["typescript"] });
    addRule(db, { slug: "lint-b", name: "B", languages: [] });
    const p = addProject(db, { name: "Snap" });
    expect(projectEnabled(p.id)).toEqual({ "lint-a": 1, "lint-b": 1 });
    expect(projectLangs(p.id, "lint-a")).toEqual(["typescript"]);
    expect(projectLangs(p.id, "lint-b")).toEqual([]);
  });

  it("rejects a duplicate slug", () => {
    addProject(db, { name: "Dup" });
    expect(() => addProject(db, { name: "dup" })).toThrow(/already exists/);
  });

  it("requires a name", () => {
    expect(() => addProject(db, { name: "" })).toThrow(/requires a name/);
  });

  it("rejects a name with no slug-able characters", () => {
    expect(() => addProject(db, { name: "!!!" })).toThrow(/no slug-able/);
  });

  it("rethrows a non-unique DB error unchanged", () => {
    db.exec("DROP TABLE projects");
    expect(() => addProject(db, { name: "X" })).toThrow(/no such table: projects/);
  });
});

describe("listProjects / getProject", () => {
  it("lists projects with the default first", () => {
    addProject(db, { name: "Zeta" });
    ensureDefaultProject(db, "/repo", "Alpha Repo");
    const names = listProjects(db).map((p) => p.name);
    expect(names[0]).toBe("Alpha Repo");
    expect(names).toContain("Zeta");
  });

  it("throws for an unknown project id", () => {
    expect(() => getProject(db, 999)).toThrow(/unknown project: 999/);
  });
});

describe("configureProject", () => {
  let id: number;
  beforeEach(() => {
    id = addProject(db, { name: "Cfg", description: "old" }).id;
  });

  it("updates name (and slug), description, and paths", () => {
    const row = configureProject(db, id, {
      name: "New Name",
      description: "new",
      files: ["/f.ts"],
      directories: ["/d"],
    });
    expect(row).toMatchObject({ name: "New Name", slug: "new-name", description: "new" });
    expect(JSON.parse(row.files as string)).toEqual(["/f.ts"]);
    expect(JSON.parse(row.directories as string)).toEqual(["/d"]);
  });

  it("clears paths when given empty arrays", () => {
    configureProject(db, id, { files: ["/f.ts"] });
    const row = configureProject(db, id, { files: [], directories: [] });
    expect(row.files).toBeNull();
    expect(row.directories).toBeNull();
  });

  it("throws when renaming onto an existing project's slug", () => {
    addProject(db, { name: "Taken" });
    expect(() => configureProject(db, id, { name: "taken" })).toThrow(
      /already uses that name/,
    );
  });

  it("throws for an unknown project id", () => {
    expect(() => configureProject(db, 999, { description: "x" })).toThrow(
      /unknown project/,
    );
  });

  it("rethrows a non-unique DB error unchanged", () => {
    db.exec("DROP TABLE projects");
    expect(() => configureProject(db, id, { description: "x" })).toThrow(
      /no such table/,
    );
  });
});

describe("setProjectRule", () => {
  let id: number;
  beforeEach(() => {
    addRule(db, { slug: "lint-r", name: "R", languages: ["typescript"] });
    id = addProject(db, { name: "P" }).id;
  });

  it("disables and re-enables a rule for the project only", () => {
    setProjectRule(db, id, "lint-r", { enabled: false });
    expect(projectEnabled(id)["lint-r"]).toBe(0);
    setProjectRule(db, id, "lint-r", { enabled: true });
    expect(projectEnabled(id)["lint-r"]).toBe(1);
  });

  it("rewrites the project's language set for a rule", () => {
    setProjectRule(db, id, "lint-r", { languages: ["javascript"] });
    expect(projectLangs(id, "lint-r")).toEqual(["javascript"]);
    setProjectRule(db, id, "lint-r", { languages: [] });
    expect(projectLangs(id, "lint-r")).toEqual([]);
  });

  it("throws for an unknown project", () => {
    expect(() => setProjectRule(db, 999, "lint-r", { enabled: false })).toThrow(
      /unknown project/,
    );
  });

  it("throws for an unknown rule", () => {
    expect(() => setProjectRule(db, id, "nope", { enabled: false })).toThrow(
      /unknown rule/,
    );
  });

  it("throws for an unknown language", () => {
    expect(() => setProjectRule(db, id, "lint-r", { languages: ["klingon"] })).toThrow(
      /unknown language/,
    );
  });
});

describe("syncProjectRules", () => {
  it("backfills rules added after the project was created", () => {
    const p = addProject(db, { name: "Late" });
    addRule(db, { slug: "lint-late", name: "Late", languages: ["typescript"] });
    expect(projectEnabled(p.id)["lint-late"]).toBeUndefined();
    syncProjectRules(db, p.id);
    expect(projectEnabled(p.id)["lint-late"]).toBe(1);
    expect(projectLangs(p.id, "lint-late")).toEqual(["typescript"]);
  });
});

describe("ensureDefaultProject", () => {
  it("creates the default project once and is idempotent", () => {
    const first = ensureDefaultProject(db, "/repo", "Repo");
    expect(first.is_default).toBe(1);
    expect(JSON.parse(first.directories as string)).toEqual(["/repo"]);
    const second = ensureDefaultProject(db, "/repo", "Repo");
    expect(second.id).toBe(first.id);
    expect(listProjects(db).filter((p) => p.is_default === 1)).toHaveLength(1);
  });
});
