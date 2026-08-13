import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDb, type Db } from "../open.js";
import {
  addRule,
  configureRule,
  registerRule,
  reorderRule,
  reorderRuleBefore,
} from "../rules.js";
import type { RulePlugin } from "../../rules/plugin.js";
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

function fixCount(slug: string): number {
  return (
    db
      .prepare(
        "SELECT count(*) AS n FROM fixes f JOIN rules r ON r.id = f.rule_id WHERE r.slug = ?",
      )
      .get(slug) as { n: number }
  ).n;
}

describe("registerRule", () => {
  it("registers a plugin with no actions, leaving the fixes table empty", () => {
    const plugin: RulePlugin = {
      meta: {
        slug: "reg-no-actions",
        name: "Reg No Actions",
        category: "naming",
        description: "exercises the undefined-actions branch",
        languages: ["typescript"],
        config: null,
        ratchetable: false,
        modes: ["staged"],
        stages: ["pre-commit"],
      },
      checkEntry: null,
    };
    registerRule(db, plugin);
    expect(
      db.prepare("SELECT slug FROM rules WHERE slug = ?").get("reg-no-actions"),
    ).toMatchObject({ slug: "reg-no-actions" });
    expect(fixCount("reg-no-actions")).toBe(0);
  });
});

function sortIndex(slug: string): number {
  return (
    db
      .prepare("SELECT sort_index AS i FROM rules WHERE slug = ?")
      .get(slug) as {
      i: number;
    }
  ).i;
}

/** The global rule order (sort_index, then slug), as slugs. */
function order(): string[] {
  return (
    db.prepare("SELECT slug FROM rules ORDER BY sort_index, slug").all() as {
      slug: string;
    }[]
  ).map((r) => r.slug);
}

function primaryCategory(slug: string): string | null {
  return (
    db.prepare("SELECT category FROM rules WHERE slug = ?").get(slug) as {
      category: string | null;
    }
  ).category;
}

function ruleStages(slug: string): string[] {
  return (
    db
      .prepare(
        "SELECT rs.stage FROM rule_stages rs JOIN rules r ON r.id = rs.rule_id WHERE r.slug = ? ORDER BY rs.stage",
      )
      .all(slug) as { stage: string }[]
  ).map((r) => r.stage);
}

function ruleSupportStages(slug: string): string[] {
  return (
    db
      .prepare(
        "SELECT rss.stage FROM rule_support_stages rss JOIN rules r ON r.id = rss.rule_id WHERE r.slug = ? ORDER BY rss.stage",
      )
      .all(slug) as { stage: string }[]
  ).map((r) => r.stage);
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

  it("defaults languages_fixed to 0 and sets it when requested", () => {
    const loose = addRule(db, { slug: "lint-loose", name: "Loose" });
    expect(loose.languages_fixed).toBe(0);
    const fixed = addRule(db, {
      slug: "lint-fixed",
      name: "Fixed",
      languages: ["typescript", "javascript"],
      languagesFixed: true,
    });
    expect(fixed.languages_fixed).toBe(1);
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
    const found = db
      .prepare("SELECT * FROM rules WHERE slug = ?")
      .get("lint-x");
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

  it("links stages to the rule", () => {
    const row = addRule(db, {
      slug: "lint-staged",
      name: "Staged",
      stages: ["pre-commit", "tool"],
    });
    const stages = (
      db
        .prepare(
          "SELECT stage FROM rule_stages WHERE rule_id = ? ORDER BY stage",
        )
        .all(row.id) as { stage: string }[]
    ).map((r) => r.stage);
    expect(stages).toEqual(["pre-commit", "tool"]);
  });

  it("rejects an unknown stage", () => {
    expect(() =>
      addRule(db, { slug: "lint-badstage", name: "Bad", stages: ["nope"] }),
    ).toThrow(/unknown stage: nope/);
  });

  it("links an explicit supportStages set", () => {
    addRule(db, {
      slug: "lint-sup",
      name: "Sup",
      stages: ["pre-commit"],
      supportStages: ["pre-commit", "pre-push", "tool"],
    });
    expect(ruleSupportStages("lint-sup")).toEqual([
      "pre-commit",
      "pre-push",
      "tool",
    ]);
  });

  it("defaults supportStages to stages when omitted", () => {
    addRule(db, {
      slug: "lint-supdef",
      name: "SupDef",
      stages: ["pre-commit", "tool"],
    });
    expect(ruleSupportStages("lint-supdef")).toEqual(["pre-commit", "tool"]);
  });

  it("rejects an unknown supportStages slug", () => {
    expect(() =>
      addRule(db, {
        slug: "lint-badsup",
        name: "BadSup",
        supportStages: ["nope"],
      }),
    ).toThrow(/unknown stage: nope/);
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
    addRule(db, {
      slug: "lint-max-lines",
      name: "Max lines",
      languages: ["typescript"],
      supportStages: ["pre-commit", "pre-push", "tool"],
    });
  });

  it("toggles enabled", () => {
    const row = configureRule(db, "lint-max-lines", { enabled: false });
    expect(row.enabled).toBe(0);
    expect(configureRule(db, "lint-max-lines", { enabled: true }).enabled).toBe(
      1,
    );
  });

  it("adds and removes language links", () => {
    configureRule(db, "lint-max-lines", { addLanguages: ["javascript"] });
    expect(langCount("lint-max-lines")).toBe(2);
    configureRule(db, "lint-max-lines", { removeLanguages: ["typescript"] });
    expect(langCount("lint-max-lines")).toBe(1);
  });

  it("adds and removes category links", () => {
    configureRule(db, "lint-max-lines", {
      addCategories: ["size", "complexity"],
    });
    expect(categories("lint-max-lines")).toEqual(["complexity", "size"]);
    configureRule(db, "lint-max-lines", { removeCategories: ["complexity"] });
    expect(categories("lint-max-lines")).toEqual(["size"]);
  });

  it("replaces the full stage set with setStages", () => {
    configureRule(db, "lint-max-lines", {
      setStages: ["pre-commit", "pre-push"],
    });
    expect(ruleStages("lint-max-lines")).toEqual(["pre-commit", "pre-push"]);
    configureRule(db, "lint-max-lines", { setStages: ["tool"] });
    expect(ruleStages("lint-max-lines")).toEqual(["tool"]);
  });

  it("rejects an unknown stage in setStages", () => {
    expect(() =>
      configureRule(db, "lint-max-lines", { setStages: ["nope"] }),
    ).toThrow(/unknown stage: nope/);
  });

  it("rejects setStages to a stage outside the rule's support set", () => {
    // The fixture supports pre-commit/pre-push/tool but not commit-msg.
    expect(() =>
      configureRule(db, "lint-max-lines", {
        setStages: ["pre-commit", "commit-msg"],
      }),
    ).toThrow(
      /cannot bind lint-max-lines to unsupported stage\(s\): commit-msg/,
    );
  });

  it("sets the absolute order with setOrder", () => {
    expect(sortIndex("lint-max-lines")).toBe(100);
    configureRule(db, "lint-max-lines", { setOrder: 5 });
    expect(sortIndex("lint-max-lines")).toBe(5);
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

describe("reorderRule", () => {
  beforeEach(() => {
    // All three seed to sort_index 100, so their order is alphabetical by slug.
    addRule(db, { slug: "rule-a", name: "A" });
    addRule(db, { slug: "rule-b", name: "B" });
    addRule(db, { slug: "rule-c", name: "C" });
  });

  it("renumbers to contiguous indices even from an all-equal start", () => {
    expect(order()).toEqual(["rule-a", "rule-b", "rule-c"]);
    reorderRule(db, "rule-c", "up");
    expect(order()).toEqual(["rule-a", "rule-c", "rule-b"]);
    expect([
      sortIndex("rule-a"),
      sortIndex("rule-c"),
      sortIndex("rule-b"),
    ]).toEqual([0, 1, 2]);
  });

  it("moves a rule down past its neighbor", () => {
    reorderRule(db, "rule-a", "down");
    expect(order()).toEqual(["rule-b", "rule-a", "rule-c"]);
  });

  it("is a no-op moving the first rule up", () => {
    reorderRule(db, "rule-a", "up");
    expect(order()).toEqual(["rule-a", "rule-b", "rule-c"]);
  });

  it("is a no-op moving the last rule down", () => {
    reorderRule(db, "rule-c", "down");
    expect(order()).toEqual(["rule-a", "rule-b", "rule-c"]);
  });

  it("rejects an unknown rule", () => {
    expect(() => reorderRule(db, "nope", "up")).toThrow(/unknown rule/);
  });
});

describe("reorderRuleBefore", () => {
  beforeEach(() => {
    addRule(db, { slug: "rule-a", name: "A" });
    addRule(db, { slug: "rule-b", name: "B" });
    addRule(db, { slug: "rule-c", name: "C" });
  });

  it("moves a rule to sit before a later target", () => {
    reorderRuleBefore(db, "rule-c", "rule-a");
    expect(order()).toEqual(["rule-c", "rule-a", "rule-b"]);
    expect([
      sortIndex("rule-c"),
      sortIndex("rule-a"),
      sortIndex("rule-b"),
    ]).toEqual([0, 1, 2]);
  });

  it("moves a rule to sit before an earlier target", () => {
    reorderRuleBefore(db, "rule-a", "rule-c");
    expect(order()).toEqual(["rule-b", "rule-a", "rule-c"]);
  });

  it("moves a rule to the end when target is null", () => {
    reorderRuleBefore(db, "rule-a", null);
    expect(order()).toEqual(["rule-b", "rule-c", "rule-a"]);
  });

  it("is a no-op when dropped on itself", () => {
    reorderRuleBefore(db, "rule-b", "rule-b");
    expect(order()).toEqual(["rule-a", "rule-b", "rule-c"]);
  });

  it("rejects an unknown rule", () => {
    expect(() => reorderRuleBefore(db, "nope", "rule-a")).toThrow(
      /unknown rule/,
    );
  });

  it("rejects an unknown target", () => {
    expect(() => reorderRuleBefore(db, "rule-a", "nope")).toThrow(
      /unknown rule/,
    );
  });
});
