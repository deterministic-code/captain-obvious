import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDb, type Db } from "../open.js";
import { addRule, configureRule } from "../rules.js";
import type { RuleActionRow } from "../types.js";

let db: Db;

// openDb seeds the language catalog (typescript/javascript included), so rules
// can link those slugs without an explicit addLanguage here.
beforeEach(() => {
  db = openDb(":memory:");
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

function categories(slug: string): string[] {
  return (
    db
      .prepare(
        "SELECT rc.category FROM rule_categories rc JOIN rules r ON r.id = rc.rule_id WHERE r.slug = ? ORDER BY rc.category",
      )
      .all(slug) as { category: string }[]
  ).map((r) => r.category);
}

function primaryCategory(slug: string): string | null {
  return (
    db.prepare("SELECT category FROM rules WHERE slug = ?").get(slug) as {
      category: string | null;
    }
  ).category;
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

  it("links the primary plus extra categories, de-duplicated", () => {
    addRule(db, {
      slug: "lint-max-lines",
      name: "Max lines",
      category: "size",
      categories: ["complexity", "size"],
    });
    expect(categories("lint-max-lines")).toEqual(["complexity", "size"]);
    expect(primaryCategory("lint-max-lines")).toBe("size");
  });

  it("links only extra categories when no primary is given", () => {
    addRule(db, { slug: "lint-x", name: "X", categories: ["naming"] });
    expect(categories("lint-x")).toEqual(["naming"]);
    expect(primaryCategory("lint-x")).toBeNull();
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

  it("requires slug and name", () => {
    expect(() => addRule(db, { slug: "", name: "X" })).toThrow(/requires/);
  });

  it("links hooks to the rule", () => {
    const envId = (
      db.prepare("SELECT id FROM environments WHERE slug = ?").get("claude") as {
        id: number;
      }
    ).id;
    db.prepare("INSERT INTO hooks (environment_id, slug) VALUES (?, ?)").run(
      envId,
      "dispatch-guard",
    );
    const row = addRule(db, {
      slug: "lint-hooked",
      name: "Hooked",
      hooks: ["dispatch-guard"],
    });
    const links = db
      .prepare("SELECT count(*) AS n FROM hook_rules WHERE rule_id = ?")
      .get(row.id) as { n: number };
    expect(links.n).toBe(1);
  });

  it("rethrows a non-unique insert error unchanged", () => {
    // Dropping the rules table makes the INSERT fail with a non-UNIQUE error,
    // so the transaction's catch must rethrow it as-is.
    db.exec("DROP TABLE rules");
    expect(() => addRule(db, { slug: "lint-x", name: "X" })).toThrow(
      /no such table: rules/,
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

  it("adds and removes category links", () => {
    configureRule(db, "lint-max-lines", { addCategories: ["size", "complexity"] });
    expect(categories("lint-max-lines")).toEqual(["complexity", "size"]);
    configureRule(db, "lint-max-lines", { removeCategories: ["complexity"] });
    expect(categories("lint-max-lines")).toEqual(["size"]);
  });

  it("re-points the primary when the primary category is removed", () => {
    addRule(db, {
      slug: "lint-multi",
      name: "Multi",
      category: "size",
      categories: ["complexity"],
    });
    expect(primaryCategory("lint-multi")).toBe("size");
    configureRule(db, "lint-multi", { removeCategories: ["size"] });
    expect(categories("lint-multi")).toEqual(["complexity"]);
    expect(primaryCategory("lint-multi")).toBe("complexity");
  });

  it("clears the primary when the last category is removed", () => {
    addRule(db, { slug: "lint-one", name: "One", category: "size" });
    configureRule(db, "lint-one", { removeCategories: ["size"] });
    expect(categories("lint-one")).toEqual([]);
    expect(primaryCategory("lint-one")).toBeNull();
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

  it("removes only the default binding, keeping env-scoped ones", () => {
    configureRule(db, "lint-max-lines", {
      setAction: { type: "warn", environment: null, delayMs: null },
    });
    configureRule(db, "lint-max-lines", {
      setAction: { type: "halt", environment: "claude", delayMs: 500 },
    });
    configureRule(db, "lint-max-lines", { removeAction: "default" });
    const rows = ruleActions("lint-max-lines");
    expect(rows).toHaveLength(1);
    expect(rows[0].environment_id).not.toBeNull();
  });

  it("removes only the binding for a named environment", () => {
    configureRule(db, "lint-max-lines", {
      setAction: { type: "warn", environment: null, delayMs: null },
    });
    configureRule(db, "lint-max-lines", {
      setAction: { type: "halt", environment: "claude", delayMs: 500 },
    });
    configureRule(db, "lint-max-lines", { removeAction: "claude" });
    const rows = ruleActions("lint-max-lines");
    expect(rows).toHaveLength(1);
    expect(rows[0].environment_id).toBeNull();
  });

  it("normalizes and updates config JSON", () => {
    const row = configureRule(db, "lint-max-lines", {
      setConfig: '{"maxLines":500}',
    });
    expect(row.config_json).toBe('{"maxLines":500}');
  });

  it("rejects invalid config JSON on update", () => {
    expect(() =>
      configureRule(db, "lint-max-lines", { setConfig: "{bad}" }),
    ).toThrow(/not valid JSON/);
  });

  it("keeps the primary category when adding another category", () => {
    addRule(db, { slug: "lint-keep", name: "Keep", category: "size" });
    configureRule(db, "lint-keep", { addCategories: ["complexity"] });
    expect(primaryCategory("lint-keep")).toBe("size");
    expect(categories("lint-keep")).toEqual(["complexity", "size"]);
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
