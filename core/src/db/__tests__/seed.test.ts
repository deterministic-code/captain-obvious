import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getRuleFixes } from "../fixes.js";
import { openDb, type Db } from "../open.js";
import { seedRules } from "../seed.js";
import { LANGUAGES } from "../../rules/languages.js";
import { RULES } from "../../rules/index.js";
import type { RulePlugin } from "../../rules/plugin.js";

let db: Db;

beforeEach(() => {
  db = openDb(":memory:");
});

afterEach(() => {
  db.close();
});

function count(table: string): number {
  return (
    db.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }
  ).n;
}

// Total language links = sum over rules of their language count. Governance
// rules are language-agnostic (languages: []) so they contribute zero.
const LANGUAGE_LINKS = RULES.reduce((n, r) => n + r.meta.languages.length, 0);

// Category links = the primary plus any extras, de-duplicated, per rule.
const CATEGORY_LINKS = RULES.reduce(
  (n, r) => n + new Set([r.meta.category, ...(r.meta.categories ?? [])]).size,
  0,
);

describe("seedRules", () => {
  it("seeds every rule plus its languages and links", () => {
    const summary = seedRules(db, RULES);
    expect(summary.seeded).toHaveLength(RULES.length);
    expect(summary.languages).toEqual(["javascript", "typescript"]);
    expect(count("rules")).toBe(RULES.length);
    // openDb already seeded the full catalog; seedRules only links, not inserts.
    expect(count("languages")).toBe(LANGUAGES.length);
    expect(count("rule_languages")).toBe(LANGUAGE_LINKS);
    expect(count("rule_categories")).toBe(CATEGORY_LINKS);
  });

  it("is idempotent", () => {
    seedRules(db, RULES);
    seedRules(db, RULES);
    expect(count("rules")).toBe(RULES.length);
    expect(count("languages")).toBe(LANGUAGES.length);
    expect(count("rule_languages")).toBe(LANGUAGE_LINKS);
    expect(count("rule_categories")).toBe(CATEGORY_LINKS);
  });

  it("preserves a user-disabled rule across re-seed", () => {
    seedRules(db, RULES);
    db.prepare("UPDATE rules SET enabled = 0 WHERE slug = ?").run(
      "lint-naming",
    );
    seedRules(db, RULES);
    const row = db
      .prepare("SELECT enabled FROM rules WHERE slug = ?")
      .get("lint-naming") as { enabled: number };
    expect(row.enabled).toBe(0);
  });

  it("seeds languages_fixed from meta and syncs it on re-seed", () => {
    seedRules(db, RULES);
    const fixedRow = () =>
      db.prepare("SELECT languages_fixed AS f FROM rules WHERE slug = ?");
    // A TS/JS lint rule declares languagesFixed; a governance rule does not.
    expect((fixedRow().get("lint-naming") as { f: number }).f).toBe(1);
    expect((fixedRow().get("gov-require-pr") as { f: number }).f).toBe(0);
    db.prepare("UPDATE rules SET languages_fixed = 0 WHERE slug = ?").run(
      "lint-naming",
    );
    seedRules(db, RULES);
    expect((fixedRow().get("lint-naming") as { f: number }).f).toBe(1);
  });

  it("updates metadata on re-seed", () => {
    seedRules(db, RULES);
    db.prepare("UPDATE rules SET description = 'stale' WHERE slug = ?").run(
      "lint-naming",
    );
    seedRules(db, RULES);
    const row = db
      .prepare("SELECT description FROM rules WHERE slug = ?")
      .get("lint-naming") as { description: string };
    expect(row.description).not.toBe("stale");
  });

  it("seeds only one rule with --only", () => {
    const summary = seedRules(db, RULES, { only: "lint-naming" });
    expect(summary.seeded).toEqual(["lint-naming"]);
    expect(count("rules")).toBe(1);
  });

  it("rejects an unknown --only slug", () => {
    expect(() => seedRules(db, RULES, { only: "lint-nope" })).toThrow(
      /unknown rule/,
    );
  });

  it("seeds a rule's actions into the fixes table (idempotently)", () => {
    seedRules(db, RULES);
    const actions = getRuleFixes(db, "lint-prettier");
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({ kind: "script" });
    const before = count("fixes");
    seedRules(db, RULES);
    expect(count("fixes")).toBe(before);
  });

  it("seeds control_json as a ControlSpec (and null when the rule declares none)", () => {
    seedRules(db, RULES);
    const control = (slug: string) =>
      (
        db
          .prepare("SELECT control_json FROM rules WHERE slug = ?")
          .get(slug) as { control_json: string | null }
      ).control_json;
    expect(JSON.parse(control("lint-protected-paths") as string)).toEqual({
      kind: "custom",
      key: "protected-paths",
    });
    expect(control("lint-naming")).toBeNull();
  });

  it("seeds a plugin's declarative control and external dependencies", () => {
    const plugin: RulePlugin = {
      meta: {
        slug: "fixture-with-deps",
        name: "Fixture with deps",
        category: "governance",
        description: "synthetic plugin exercising control_json + deps_json",
        languages: [],
        config: { maxLines: 42 },
        ratchetable: false,
        modes: ["staged"],
        stages: ["pre-commit"],
        actions: [],
      },
      control: {
        kind: "declarative",
        fields: [
          { key: "maxLines", label: "Max lines", type: "number", min: 1 },
        ],
      },
      dependencies: [{ kind: "bin", name: "gh" }],
      checkEntry: "rules/fixture-with-deps/check.mjs",
    };
    seedRules(db, [plugin]);
    const row = db
      .prepare("SELECT control_json, deps_json FROM rules WHERE slug = ?")
      .get("fixture-with-deps") as { control_json: string; deps_json: string };
    expect(JSON.parse(row.control_json)).toEqual(plugin.control);
    expect(JSON.parse(row.deps_json)).toEqual([{ kind: "bin", name: "gh" }]);
  });

  const orderFixture = (slug: string, order?: number): RulePlugin => ({
    meta: {
      slug,
      name: slug,
      category: "governance",
      description: "order fixture",
      languages: [],
      config: null,
      ratchetable: false,
      modes: ["staged"],
      stages: ["pre-commit"],
      order,
      actions: [],
    },
    checkEntry: "rules/" + slug + "/check.mjs",
  });

  const sortIndex = (slug: string): number =>
    (
      db
        .prepare("SELECT sort_index AS i FROM rules WHERE slug = ?")
        .get(slug) as { i: number }
    ).i;

  it("seeds sort_index from meta.order, defaulting to 100 when absent", () => {
    seedRules(db, [
      orderFixture("fixture-early", 5),
      orderFixture("fixture-default"),
    ]);
    expect(sortIndex("fixture-early")).toBe(5);
    expect(sortIndex("fixture-default")).toBe(100);
  });

  it("preserves a user-set order across re-seed (like enabled)", () => {
    seedRules(db, [orderFixture("fixture-order", 5)]);
    db.prepare("UPDATE rules SET sort_index = 7 WHERE slug = ?").run(
      "fixture-order",
    );
    seedRules(db, [orderFixture("fixture-order", 5)]);
    expect(sortIndex("fixture-order")).toBe(7);
  });
});
