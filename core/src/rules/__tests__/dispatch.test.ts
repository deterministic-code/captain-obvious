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

  it("orders dispatched rules by sort_index, lowest first", () => {
    const before = slugsFor("pre-commit");
    expect(before.length).toBeGreaterThan(1);
    const last = before[before.length - 1];
    db.prepare("UPDATE rules SET sort_index = 1 WHERE slug = ?").run(last);
    const after = slugsFor("pre-commit");
    expect(after[0]).toBe(last);
    // Same membership, just reordered.
    expect([...after].sort()).toEqual([...before].sort());
  });

  it("never includes server-stage rules in a local stage", () => {
    const all = [...slugsFor("pre-commit"), ...slugsFor("pre-push")];
    expect(all).not.toContain("gov-require-pr");
  });

  it("dispatches the whole-repo lint-dead-code at pre-push, not pre-commit", () => {
    expect(slugsFor("pre-push")).toContain("lint-dead-code");
    expect(slugsFor("pre-commit")).not.toContain("lint-dead-code");
  });

  it("omits a disabled rule", () => {
    expect(slugsFor("pre-commit")).toContain("lint-naming");
    db.prepare("UPDATE rules SET enabled = 0 WHERE slug = ?").run("lint-naming");
    expect(slugsFor("pre-commit")).not.toContain("lint-naming");
  });

  it("defaults an unbound rule's action to halt, with no fix", () => {
    const entry = selectDispatch(db, "pre-commit").find(
      (d) => d.slug === "lint-naming",
    );
    expect(entry?.action).toBe("halt");
    expect(entry?.fix).toBeNull();
  });

  it("reports the rule's default binding as its action", () => {
    db.prepare(
      "INSERT INTO rule_actions (rule_id, environment_id, action_type_id) VALUES (?, NULL, ?)",
    ).run(ruleId("lint-naming"), actionTypeId("warn"));
    const entry = selectDispatch(db, "pre-commit").find(
      (d) => d.slug === "lint-naming",
    );
    expect(entry?.action).toBe("warn");
    expect(entry?.fix).toBeNull();
  });

  it("attaches the script fix for a rule bound to a fix action", () => {
    db.prepare(
      "INSERT INTO rule_actions (rule_id, environment_id, action_type_id) VALUES (?, NULL, ?)",
    ).run(ruleId("lint-prettier"), actionTypeId("fix_and_halt"));
    const entry = selectDispatch(db, "pre-commit").find(
      (d) => d.slug === "lint-prettier",
    );
    expect(entry?.action).toBe("fix_and_halt");
    expect(entry?.fix).toMatchObject({ kind: "script" });
  });

  it("throws when a fix-bound rule declares no script fix", () => {
    db.prepare(
      "INSERT INTO rule_actions (rule_id, environment_id, action_type_id) VALUES (?, NULL, ?)",
    ).run(ruleId("lint-naming"), actionTypeId("fix"));
    expect(() => selectDispatch(db, "pre-commit")).toThrow(/no script fix/);
  });
});
