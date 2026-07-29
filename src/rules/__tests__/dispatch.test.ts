import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDb, type Db } from "../../db/open.js";
import { seedRules } from "../../db/seed.js";
import { selectDispatch } from "../dispatch.js";
import { RULES } from "../index.js";

let db: Db;

beforeEach(() => {
  db = openDb(":memory:");
  seedRules(db, RULES);
});

afterEach(() => {
  db.close();
});

function slugsFor(stage: "pre-commit" | "pre-push"): string[] {
  return selectDispatch(db, stage).map((d) => d.slug);
}

function actionTypeId(slug: string): number {
  return (
    db.prepare("SELECT id FROM action_types WHERE slug = ?").get(slug) as {
      id: number;
    }
  ).id;
}

function ruleId(slug: string): number {
  return (
    db.prepare("SELECT id FROM rules WHERE slug = ?").get(slug) as { id: number }
  ).id;
}

describe("selectDispatch", () => {
  it("returns only the rules whose package stage matches, in seed order", () => {
    const expected = RULES.filter((r) =>
      r.meta.stages.includes("pre-commit"),
    ).map((r) => r.meta.slug);
    expect(slugsFor("pre-commit")).toEqual(expected);
  });

  it("never includes server-stage rules in a local stage", () => {
    const all = [...slugsFor("pre-commit"), ...slugsFor("pre-push")];
    expect(all).not.toContain("gov-require-pr");
  });

  it("omits a disabled rule", () => {
    expect(slugsFor("pre-commit")).toContain("lint-naming");
    db.prepare("UPDATE rules SET enabled = 0 WHERE slug = ?").run("lint-naming");
    expect(slugsFor("pre-commit")).not.toContain("lint-naming");
  });

  it("marks a rule advisory when it has a default warn binding", () => {
    const before = selectDispatch(db, "pre-commit").find(
      (d) => d.slug === "lint-naming",
    );
    expect(before?.advisory).toBe(false);

    db.prepare(
      "INSERT INTO rule_actions (rule_id, environment_id, action_type_id) VALUES (?, NULL, ?)",
    ).run(ruleId("lint-naming"), actionTypeId("warn"));

    const after = selectDispatch(db, "pre-commit").find(
      (d) => d.slug === "lint-naming",
    );
    expect(after?.advisory).toBe(true);
  });

  it("treats a halt binding as blocking, not advisory", () => {
    db.prepare(
      "INSERT INTO rule_actions (rule_id, environment_id, action_type_id) VALUES (?, NULL, ?)",
    ).run(ruleId("lint-naming"), actionTypeId("halt"));
    const entry = selectDispatch(db, "pre-commit").find(
      (d) => d.slug === "lint-naming",
    );
    expect(entry?.advisory).toBe(false);
  });
});
