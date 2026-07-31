import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDb, type Db } from "../open.js";
import { addRule } from "../rules.js";
import {
  addProject,
  configureProject,
  ensureDefaultProject,
  getDefaultProjectProtected,
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

/** project_rules.config_json for one rule in a project. */
function projectConfig(projectId: number, ruleSlug: string): string | null {
  const row = db
    .prepare(
      `SELECT pr.config_json AS configJson
         FROM project_rules pr JOIN rules r ON r.id = pr.rule_id
        WHERE pr.project_id = ? AND r.slug = ?`,
    )
    .get(projectId, ruleSlug) as { configJson: string | null };
  return row.configJson;
}

/** project_rule_actions for one rule, keyed by environment slug ("default" for the all-env row). */
function projectActions(
  projectId: number,
  ruleSlug: string,
): Record<string, { type: string; delayMs: number | null }> {
  const rows = db
    .prepare(
      `SELECT e.slug AS environment, at.slug AS type, pra.delay_ms AS delayMs
         FROM project_rule_actions pra
         JOIN rules r ON r.id = pra.rule_id
         JOIN action_types at ON at.id = pra.action_type_id
         LEFT JOIN environments e ON e.id = pra.environment_id
        WHERE pra.project_id = ? AND r.slug = ?`,
    )
    .all(projectId, ruleSlug) as {
    environment: string | null;
    type: string;
    delayMs: number | null;
  }[];
  return Object.fromEntries(
    rows.map((r) => [
      r.environment ?? "default",
      { type: r.type, delayMs: r.delayMs },
    ]),
  );
}

describe("addProject", () => {
  it("inserts a project, deriving a kebab slug and JSON-encoding paths", () => {
    const row = addProject(db, {
      name: "My App",
      description: "the app",
      files: ["/a/x.ts"],
      directories: ["/a/src"],
      protected: ["db/schema.sql", ".github/**"],
    });
    expect(row).toMatchObject({
      slug: "my-app",
      name: "My App",
      description: "the app",
    });
    expect(JSON.parse(row.files as string)).toEqual(["/a/x.ts"]);
    expect(JSON.parse(row.directories as string)).toEqual(["/a/src"]);
    expect(JSON.parse(row.protected as string)).toEqual([
      "db/schema.sql",
      ".github/**",
    ]);
    expect(row.is_default).toBe(0);
  });

  it("stores null paths when none are given", () => {
    const row = addProject(db, { name: "Bare" });
    expect(row.files).toBeNull();
    expect(row.directories).toBeNull();
    expect(row.protected).toBeNull();
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
    expect(() => addProject(db, { name: "X" })).toThrow(
      /no such table: projects/,
    );
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
      protected: ["src/**"],
    });
    expect(row).toMatchObject({
      name: "New Name",
      slug: "new-name",
      description: "new",
    });
    expect(JSON.parse(row.files as string)).toEqual(["/f.ts"]);
    expect(JSON.parse(row.directories as string)).toEqual(["/d"]);
    expect(JSON.parse(row.protected as string)).toEqual(["src/**"]);
  });

  it("clears paths when given empty arrays", () => {
    configureProject(db, id, { files: ["/f.ts"], protected: ["src/**"] });
    const row = configureProject(db, id, {
      files: [],
      directories: [],
      protected: [],
    });
    expect(row.files).toBeNull();
    expect(row.directories).toBeNull();
    expect(row.protected).toBeNull();
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
    expect(() =>
      setProjectRule(db, id, "lint-r", { languages: ["klingon"] }),
    ).toThrow(/unknown language/);
  });

  it("sets and clears the project config override", () => {
    setProjectRule(db, id, "lint-r", {
      config: JSON.stringify({ maxLines: 50 }),
    });
    expect(JSON.parse(projectConfig(id, "lint-r") as string)).toEqual({
      maxLines: 50,
    });
    setProjectRule(db, id, "lint-r", { config: null });
    expect(projectConfig(id, "lint-r")).toBeNull();
  });

  it("upserts default and per-env action bindings, with delay", () => {
    setProjectRule(db, id, "lint-r", {
      setAction: { type: "delay_halt", environment: null, delayMs: 500 },
    });
    setProjectRule(db, id, "lint-r", {
      setAction: { type: "warn", environment: "claude", delayMs: null },
    });
    expect(projectActions(id, "lint-r")).toEqual({
      default: { type: "delay_halt", delayMs: 500 },
      claude: { type: "warn", delayMs: null },
    });
    // Re-setting the default replaces it rather than duplicating the NULL-env row.
    setProjectRule(db, id, "lint-r", {
      setAction: { type: "halt", environment: null, delayMs: null },
    });
    expect(projectActions(id, "lint-r").default).toEqual({
      type: "halt",
      delayMs: null,
    });
  });

  it("removes a single env binding, the default, or all bindings", () => {
    setProjectRule(db, id, "lint-r", {
      setAction: { type: "halt", environment: null, delayMs: null },
    });
    setProjectRule(db, id, "lint-r", {
      setAction: { type: "warn", environment: "claude", delayMs: null },
    });
    setProjectRule(db, id, "lint-r", { removeAction: "claude" });
    expect(Object.keys(projectActions(id, "lint-r"))).toEqual(["default"]);
    setProjectRule(db, id, "lint-r", {
      setAction: { type: "warn", environment: "cursor", delayMs: null },
    });
    setProjectRule(db, id, "lint-r", { removeAction: "default" });
    expect(Object.keys(projectActions(id, "lint-r"))).toEqual(["cursor"]);
    setProjectRule(db, id, "lint-r", { removeAction: "all" });
    expect(projectActions(id, "lint-r")).toEqual({});
  });

  it("throws for an unknown action type or environment", () => {
    expect(() =>
      setProjectRule(db, id, "lint-r", {
        setAction: { type: "nope", environment: null, delayMs: null },
      }),
    ).toThrow(/unknown action type/);
    expect(() =>
      setProjectRule(db, id, "lint-r", {
        setAction: { type: "warn", environment: "ghost", delayMs: null },
      }),
    ).toThrow(/unknown environment/);
    expect(() =>
      setProjectRule(db, id, "lint-r", { removeAction: "ghost" }),
    ).toThrow(/unknown environment/);
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

describe("getDefaultProjectProtected", () => {
  it("returns [] when there is no default project", () => {
    addProject(db, { name: "NotDefault" });
    expect(getDefaultProjectProtected(db)).toEqual([]);
  });

  it("returns [] when the default project protects nothing", () => {
    ensureDefaultProject(db, "/repo", "Repo");
    expect(getDefaultProjectProtected(db)).toEqual([]);
  });

  it("returns the default project's protected globs once configured", () => {
    const p = ensureDefaultProject(db, "/repo", "Repo");
    configureProject(db, p.id, { protected: ["db/schema.sql", ".github/**"] });
    expect(getDefaultProjectProtected(db)).toEqual([
      "db/schema.sql",
      ".github/**",
    ]);
  });
});
