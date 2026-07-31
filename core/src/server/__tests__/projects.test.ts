import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDb, type Db } from "../../db/open.js";
import { addRule } from "../../db/rules.js";
import {
  createProject,
  listProjectRules,
  listProjects,
  listRules,
  patchProjectRule,
  updateProject,
} from "../registry.js";

let db: Db;

beforeEach(() => {
  db = openDb(":memory:");
  addRule(db, { slug: "lint-ts", name: "TS", languages: ["typescript"] });
  addRule(db, { slug: "lint-repo", name: "Repo", languages: [] });
});

afterEach(() => {
  db.close();
});

function ruleView(views: ReturnType<typeof listRules>, slug: string) {
  const found = views.find((r) => r.slug === slug);
  if (!found) throw new Error(`missing rule view: ${slug}`);
  return found;
}

describe("createProject / listProjects", () => {
  it("creates a project and returns it as a view with parsed paths", () => {
    const created = createProject(db, {
      name: "Web",
      description: "frontend",
      directories: ["/repo/web"],
      protected: ["db/schema.sql"],
    });
    expect(created).toMatchObject({
      slug: "web",
      name: "Web",
      description: "frontend",
      isDefault: false,
    });
    expect(created.directories).toEqual(["/repo/web"]);
    expect(created.files).toEqual([]);
    expect(created.protected).toEqual(["db/schema.sql"]);
    expect(listProjects(db).map((p) => p.slug)).toContain("web");
  });

  it("defaults protected to [] when omitted", () => {
    const created = createProject(db, { name: "Bare" });
    expect(created.protected).toEqual([]);
  });

  it("requires a non-empty name", () => {
    expect(() => createProject(db, {})).toThrow(/name is required/);
    expect(() => createProject(db, { name: "  " })).toThrow(/name is required/);
  });
});

describe("updateProject", () => {
  it("edits a project and returns the updated view", () => {
    const p = createProject(db, { name: "Api" });
    const updated = updateProject(db, p.id, {
      description: "backend",
      files: ["/f.ts"],
      protected: ["migrations/**"],
    });
    expect(updated).toMatchObject({ slug: "api", description: "backend" });
    expect(updated.files).toEqual(["/f.ts"]);
    expect(updated.protected).toEqual(["migrations/**"]);
  });
});

describe("listProjectRules", () => {
  it("returns every rule with the project's enabled + languages overlay", () => {
    const p = createProject(db, { name: "Scoped" });
    const rules = listProjectRules(db, p.id);
    expect(ruleView(rules, "lint-ts")).toMatchObject({
      enabled: true,
      languages: ["typescript"],
      languageIndependent: false,
    });
    expect(ruleView(rules, "lint-repo")).toMatchObject({
      enabled: true,
      languages: [],
      languageIndependent: true,
    });
  });

  it("throws for an unknown project", () => {
    expect(() => listProjectRules(db, 999)).toThrow(/unknown project/);
  });
});

describe("patchProjectRule", () => {
  it("scopes enabled changes to one project, leaving others and the global state intact", () => {
    const a = createProject(db, { name: "Alpha" });
    const b = createProject(db, { name: "Beta" });
    const view = patchProjectRule(db, a.id, "lint-ts", { enabled: false });
    expect(view.enabled).toBe(false);
    expect(ruleView(listProjectRules(db, a.id), "lint-ts").enabled).toBe(false);
    expect(ruleView(listProjectRules(db, b.id), "lint-ts").enabled).toBe(true);
    expect(ruleView(listRules(db), "lint-ts").enabled).toBe(true);
  });

  it("scopes language changes to one project", () => {
    const a = createProject(db, { name: "Gamma" });
    const view = patchProjectRule(db, a.id, "lint-ts", {
      languages: ["javascript"],
    });
    expect(view.languages).toEqual(["javascript"]);
    expect(ruleView(listRules(db), "lint-ts").languages).toEqual([
      "typescript",
    ]);
  });
});
