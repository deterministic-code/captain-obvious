import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getRuleFixes } from "../fixes.js";
import { openDb, type Db } from "../open.js";
import { seedRules } from "../seed.js";
import { LANGUAGES } from "../../rules/languages.js";
import { RULES } from "../../rules/index.js";

let db: Db;

beforeEach(() => {
  db = openDb(":memory:");
});

afterEach(() => {
  db.close();
});

function count(table: string): number {
  return (db.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number })
    .n;
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
    db.prepare("UPDATE rules SET enabled = 0 WHERE slug = ?").run("lint-naming");
    seedRules(db, RULES);
    const row = db
      .prepare("SELECT enabled FROM rules WHERE slug = ?")
      .get("lint-naming") as { enabled: number };
    expect(row.enabled).toBe(0);
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

  it("seeds settings_controls as JSON (and null when the rule declares none)", () => {
    seedRules(db, RULES);
    const controls = (slug: string) =>
      (
        db
          .prepare("SELECT settings_controls FROM rules WHERE slug = ?")
          .get(slug) as { settings_controls: string | null }
      ).settings_controls;
    expect(JSON.parse(controls("lint-protected-paths") as string)).toEqual([
      "protected-paths",
    ]);
    expect(controls("lint-naming")).toBeNull();
  });
});
