import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setRuleFixes } from "../../db/fixes.js";
import { addLanguage } from "../../db/languages.js";
import { openDb, type Db } from "../../db/open.js";
import { addRule, configureRule } from "../../db/rules.js";
import { PANEL_EXT } from "../panelExt.js";
import {
  addActionType,
  getMeta,
  getStats,
  listRules,
  patchRule,
  seed,
} from "../registry.js";

let db: Db;

beforeEach(() => {
  db = openDb(":memory:");
  addLanguage(db, { slug: "typescript", name: "TypeScript" });
});

afterEach(() => {
  db.close();
});

function view(slug: string) {
  const found = listRules(db).find((r) => r.slug === slug);
  if (!found) throw new Error(`missing rule view: ${slug}`);
  return found;
}

describe("listRules categories", () => {
  it("exposes the full set with the primary first, keeping the scalar category", () => {
    addRule(db, {
      slug: "lint-multi",
      name: "Multi",
      category: "size",
      categories: ["complexity", "naming"],
    });
    const v = view("lint-multi");
    expect(v.category).toBe("size");
    expect(v.categories[0]).toBe("size");
    expect([...v.categories].sort()).toEqual(["complexity", "naming", "size"]);
  });

  it("returns the categories present when a rule has no primary", () => {
    addRule(db, { slug: "lint-no-primary", name: "NP", categories: ["naming"] });
    const v = view("lint-no-primary");
    expect(v.category).toBeNull();
    expect(v.categories).toEqual(["naming"]);
  });

  it("returns an empty set for an uncategorized rule", () => {
    addRule(db, { slug: "lint-bare", name: "Bare" });
    expect(view("lint-bare").categories).toEqual([]);
  });
});

describe("listRules config parsing", () => {
  it("parses valid object config", () => {
    addRule(db, {
      slug: "lint-cfg",
      name: "Cfg",
      config: JSON.stringify({ maxLines: 300 }),
    });
    expect(view("lint-cfg").config).toEqual({ maxLines: 300 });
  });

  it("returns null config when the rule has none", () => {
    addRule(db, { slug: "lint-none", name: "None" });
    expect(view("lint-none").config).toBeNull();
  });

  it("returns null when config_json is a non-object JSON value", () => {
    // A bare number is valid JSON but not an object; parseConfig drops it.
    addRule(db, { slug: "lint-scalar", name: "Scalar", config: "42" });
    expect(view("lint-scalar").config).toBeNull();
  });

  it("returns null when config_json is malformed JSON", () => {
    // normalizeConfig guards addRule, so write the bad value straight to the row.
    addRule(db, { slug: "lint-bad", name: "Bad" });
    db.prepare("UPDATE rules SET config_json = ? WHERE slug = ?").run(
      "{not json",
      "lint-bad",
    );
    expect(view("lint-bad").config).toBeNull();
  });
});

describe("listRules actions and bindings", () => {
  it("resolves the default action and per-environment overrides", () => {
    addRule(db, { slug: "lint-act", name: "Act", languages: ["typescript"] });
    configureRule(db, "lint-act", {
      setAction: { type: "halt", environment: null, delayMs: null },
    });
    configureRule(db, "lint-act", {
      setAction: { type: "delay_halt", environment: "claude", delayMs: 5000 },
    });
    const v = view("lint-act");
    expect(v.defaultAction).toEqual({ type: "halt", delayMs: null });
    expect(v.envActions).toEqual([{ environment: "claude", type: "delay_halt" }]);
  });

  it("has a null default action and empty envActions when unbound", () => {
    addRule(db, { slug: "lint-unbound", name: "Unbound" });
    const v = view("lint-unbound");
    expect(v.defaultAction).toBeNull();
    expect(v.envActions).toEqual([]);
  });

  it("surfaces the fixes-table actions with all optional fields", () => {
    addRule(db, { slug: "lint-fix", name: "Fix" });
    setRuleFixes(db, "lint-fix", [
      {
        kind: "script",
        scriptPath: "hooks/git/fix.mjs",
        description: "runs the fixer",
      },
      { kind: "inferred" },
      { kind: "script", scriptBody: "echo hi" },
    ]);
    const v = view("lint-fix");
    expect(v.actions).toEqual([
      {
        kind: "script",
        scriptPath: "hooks/git/fix.mjs",
        description: "runs the fixer",
      },
      { kind: "inferred" },
      { kind: "script", scriptBody: "echo hi" },
    ]);
  });

  it("returns an empty actions array when the rule declares none", () => {
    addRule(db, { slug: "lint-nofix", name: "NoFix" });
    expect(view("lint-nofix").actions).toEqual([]);
  });
});

describe("getMeta", () => {
  it("returns the seeded action-type and environment dropdown sources", () => {
    const meta = getMeta(db);
    expect(meta.actionTypes.map((a) => a.slug)).toEqual([
      "delay_halt",
      "halt",
      "warn",
    ]);
    expect(meta.environments.map((e) => e.slug)).toEqual([
      "claude",
      "cursor",
      "github",
    ]);
  });
});

describe("getStats", () => {
  it("counts totals, enabled/disabled, and the three breakdowns", () => {
    addRule(db, { slug: "lint-a", name: "A", category: "size" });
    addRule(db, { slug: "lint-b", name: "B", category: "size" });
    addRule(db, { slug: "lint-c", name: "C" }); // uncategorized
    configureRule(db, "lint-b", { enabled: false });
    configureRule(db, "lint-a", {
      setAction: { type: "halt", environment: null, delayMs: null },
    });
    // An env-specific binding must NOT count toward byActionType (defaults only).
    configureRule(db, "lint-a", {
      setAction: { type: "warn", environment: "claude", delayMs: null },
    });

    const stats = getStats(db);
    expect(stats.total).toBe(3);
    expect(stats.enabled).toBe(2);
    expect(stats.disabled).toBe(1);
    expect(stats.byCategory).toEqual({ size: 2, uncategorized: 1 });
    expect(stats.byActionType).toEqual({ halt: 1 });
    // No rule is in META_BY_SLUG (all custom), so every stage is "unknown".
    expect(stats.byStage).toEqual({ unknown: 3 });
  });

  it("resolves byStage from the registry metadata for bundled rules", () => {
    // Seeding real rules means their slugs hit META_BY_SLUG, so byStage carries
    // the concrete stages rather than the "unknown" fallback.
    seed(db);
    const stats = getStats(db);
    expect(Object.keys(stats.byStage)).not.toEqual(["unknown"]);
    const stagedTotal = Object.values(stats.byStage).reduce((a, b) => a + b, 0);
    expect(stagedTotal).toBe(stats.total);
    expect(stats.byStage).toHaveProperty("pre-commit");
  });
});

describe("patchRule", () => {
  it("toggles enabled and returns the updated view", () => {
    addRule(db, { slug: "lint-p", name: "P" });
    const v = patchRule(db, "lint-p", { enabled: false });
    expect(v.enabled).toBe(false);
  });

  it("sets config", () => {
    addRule(db, { slug: "lint-pc", name: "PC" });
    const v = patchRule(db, "lint-pc", { config: { maxLines: 120 } });
    expect(v.config).toEqual({ maxLines: 120 });
  });

  it("sets a default action (environment omitted) and an env override", () => {
    addRule(db, { slug: "lint-pa", name: "PA" });
    const def = patchRule(db, "lint-pa", { setAction: { type: "halt" } });
    expect(def.defaultAction).toEqual({ type: "halt", delayMs: null });
    const env = patchRule(db, "lint-pa", {
      setAction: { type: "warn", environment: "cursor" },
    });
    expect(env.envActions).toEqual([{ environment: "cursor", type: "warn" }]);
  });

  it("removes an action", () => {
    addRule(db, { slug: "lint-pr", name: "PR" });
    patchRule(db, "lint-pr", { setAction: { type: "halt" } });
    const v = patchRule(db, "lint-pr", { removeAction: "default" });
    expect(v.defaultAction).toBeNull();
  });

  it("throws for an unknown rule when the patch is a no-op", () => {
    // With no mutation op, configureRule is never called; the missing view on the
    // final read is what surfaces the unknown rule.
    expect(() => patchRule(db, "no-such-rule", {})).toThrow(
      "unknown rule: no-such-rule",
    );
  });
});

describe("addActionType", () => {
  it("adds a new action type", () => {
    const created = addActionType(db, { slug: "notify", name: "Notify" });
    expect(created).toMatchObject({ slug: "notify", name: "Notify" });
    expect(getMeta(db).actionTypes.map((a) => a.slug)).toContain("notify");
  });

  it("defaults add to true and the name to the slug", () => {
    const created = addActionType(db, { slug: "escalate" });
    expect(created).toMatchObject({ slug: "escalate", name: "escalate" });
  });

  it("throws when the slug is missing or blank", () => {
    expect(() => addActionType(db, { slug: "  " })).toThrow("slug is required");
    expect(() => addActionType(db, {})).toThrow("slug is required");
  });
});

describe("seed", () => {
  it("populates the registry from the bundled rule set", () => {
    const summary = seed(db);
    expect(summary.seeded.length).toBeGreaterThan(0);
    expect(summary.languages).toContain("typescript");
    // The seeded rules are now readable through the same shaping path.
    const rules = listRules(db);
    expect(rules.length).toBe(summary.seeded.length);
  });
});

describe("PANEL_EXT", () => {
  it("is a non-empty IIFE string the serve layer injects into the panel", () => {
    expect(typeof PANEL_EXT).toBe("string");
    expect(PANEL_EXT).toContain("/api/rules");
    expect(PANEL_EXT.trim().startsWith("(()")).toBe(true);
  });
});
