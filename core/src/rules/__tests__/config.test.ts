import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDb, type Db } from "../../db/open.js";
import { ensureDefaultProject, setProjectRule } from "../../db/projects.js";
import { seedRules } from "../../db/seed.js";
import { ruleConfigFromDb } from "../config.js";
import { RULES } from "../index.js";

let db: Db;

beforeEach(() => {
  db = openDb(":memory:");
  seedRules(db, RULES);
});

afterEach(() => {
  db.close();
});

describe("ruleConfigFromDb", () => {
  it("returns the rule's global config when no project override exists", () => {
    expect(ruleConfigFromDb(db, "lint-max-lines")).toEqual({ maxLines: 60 });
  });

  it("overlays the default project's per-rule override on the global config", () => {
    const project = ensureDefaultProject(db, "/repo", "repo");
    setProjectRule(db, project.id, "lint-max-lines", {
      config: JSON.stringify({ maxLines: 40 }),
    });
    expect(ruleConfigFromDb(db, "lint-max-lines")).toEqual({ maxLines: 40 });
  });

  it("returns {} for a rule that has no config and no override", () => {
    expect(ruleConfigFromDb(db, "lint-naming")).toEqual({});
  });

  it("returns {} for an unknown rule", () => {
    expect(ruleConfigFromDb(db, "does-not-exist")).toEqual({});
  });
});
