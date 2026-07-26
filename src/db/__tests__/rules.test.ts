import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { addLanguage } from "../languages.js";
import { openDb, type Db } from "../open.js";
import { addRule, configureRule } from "../rules.js";
import type { RuleActionRow } from "../types.js";

let db: Db;

beforeEach(() => {
  db = openDb(":memory:");
  addLanguage(db, { slug: "typescript", name: "TypeScript" });
  addLanguage(db, { slug: "javascript", name: "JavaScript" });
});

afterEach(() => {
  db.close();
});

function ruleActions(slug: string): RuleActionRow[] {
  return db
    .prepare(
      "SELECT ra.* FROM rule_actions ra JOIN rules r ON r.id = ra.rule_id WHERE r.slug = ?",
    )
    .all(slug) as RuleActionRow[];
}

function langCount(slug: string): number {
  const row = db
    .prepare(
      "SELECT count(*) AS n FROM rule_languages rl JOIN rules r ON r.id = rl.rule_id WHERE r.slug = ?",
    )
    .get(slug) as { n: number };
  return row.n;
}

describe("addRule", () => {
  it("inserts a rule and links languages", () => {
    const row = addRule(db, {
      slug: "lint-max-lines",
      name: "Max lines",
      category: "size",
      languages: ["typescript", "javascript"],
      config: '{"maxLines":300}',
    });
    expect(row.slug).toBe("lint-max-lines");
    expect(row.config_json).toBe('{"maxLines":300}');
    expect(langCount("lint-max-lines")).toBe(2);
  });

  it("rolls back with no partial write on an unknown language", () => {
    expect(() =>
      addRule(db, { slug: "lint-x", name: "X", languages: ["cobol"] }),
    ).toThrow(/unknown language/);
    const found = db.prepare("SELECT * FROM rules WHERE slug = ?").get("lint-x");
    expect(found).toBeUndefined();
  });

  it("rejects invalid config JSON", () => {
    expect(() =>
      addRule(db, { slug: "lint-x", name: "X", config: "{not json}" }),
    ).toThrow(/not valid JSON/);
  });

  it("rejects a duplicate slug", () => {
    addRule(db, { slug: "lint-dup", name: "Dup" });
    expect(() => addRule(db, { slug: "lint-dup", name: "Dup2" })).toThrow(
      /already exists/,
    );
  });
});

describe("configureRule", () => {
  beforeEach(() => {
    addRule(db, { slug: "lint-max-lines", name: "Max lines", languages: ["typescript"] });
  });

  it("toggles enabled", () => {
    const row = configureRule(db, "lint-max-lines", { enabled: false });
    expect(row.enabled).toBe(0);
    expect(configureRule(db, "lint-max-lines", { enabled: true }).enabled).toBe(1);
  });

  it("adds and removes language links", () => {
    configureRule(db, "lint-max-lines", { addLanguages: ["javascript"] });
    expect(langCount("lint-max-lines")).toBe(2);
    configureRule(db, "lint-max-lines", { removeLanguages: ["typescript"] });
    expect(langCount("lint-max-lines")).toBe(1);
  });

  it("upserts a default action binding without duplicating it", () => {
    configureRule(db, "lint-max-lines", {
      setAction: { type: "warn", environment: null, delayMs: null },
    });
    configureRule(db, "lint-max-lines", {
      setAction: { type: "halt", environment: null, delayMs: null },
    });
    const rows = ruleActions("lint-max-lines");
    expect(rows).toHaveLength(1);
    expect(rows[0].environment_id).toBeNull();
  });

  it("keeps env-scoped and default bindings distinct", () => {
    configureRule(db, "lint-max-lines", {
      setAction: { type: "warn", environment: null, delayMs: null },
    });
    configureRule(db, "lint-max-lines", {
      setAction: { type: "halt", environment: "claude", delayMs: 500 },
    });
    expect(ruleActions("lint-max-lines")).toHaveLength(2);
  });

  it("removes all bindings", () => {
    configureRule(db, "lint-max-lines", {
      setAction: { type: "warn", environment: null, delayMs: null },
    });
    configureRule(db, "lint-max-lines", { removeAction: "all" });
    expect(ruleActions("lint-max-lines")).toHaveLength(0);
  });

  it("rejects an unknown rule", () => {
    expect(() => configureRule(db, "nope", {})).toThrow(/unknown rule/);
  });

  it("rejects an unknown action environment", () => {
    expect(() =>
      configureRule(db, "lint-max-lines", {
        setAction: { type: "halt", environment: "vim", delayMs: null },
      }),
    ).toThrow(/unknown environment/);
  });
});
