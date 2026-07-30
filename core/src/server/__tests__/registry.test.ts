import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setRuleFixes } from "../../db/fixes.js";
import { openDb, type Db } from "../../db/open.js";
import { addRule, configureRule } from "../../db/rules.js";
import { PANEL_EXT } from "../panelExt.js";
import {
  addActionType,
  createProject,
  getMeta,
  getMode,
  getStats,
  listProjectRules,
  listRules,
  patchProjectRule,
  patchRule,
  seed,
} from "../registry.js";

let db: Db;

// openDb seeds the language catalog, so typescript already exists for linking.
beforeEach(() => {
  db = openDb(":memory:");
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

  it("exposes the rule's linked languages (sorted), empty when none", () => {
    addRule(db, {
      slug: "lint-lang",
      name: "Lang",
      languages: ["typescript", "javascript"],
    });
    addRule(db, { slug: "lint-nolang", name: "NoLang" });
    expect(view("lint-lang").languages).toEqual(["javascript", "typescript"]);
    expect(view("lint-nolang").languages).toEqual([]);
  });

  it("flags a rule as language-independent exactly when it has no languages", () => {
    addRule(db, { slug: "lint-scoped", name: "Scoped", languages: ["typescript"] });
    addRule(db, { slug: "lint-agnostic", name: "Agnostic" });
    expect(view("lint-scoped").languageIndependent).toBe(false);
    expect(view("lint-agnostic").languageIndependent).toBe(true);
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

  it("lists only supported languages, alphabetically by name", () => {
    const langs = getMeta(db).languages;
    expect(langs.map((l) => l.slug)).toEqual([
      "csharp",
      "javascript",
      "typescript",
    ]);
    expect(langs.every((l) => typeof l.name === "string")).toBe(true);
  });
});

describe("getStats", () => {
  it("counts totals, enabled/disabled, and the three breakdowns", () => {
    addRule(db, { slug: "lint-a", name: "A", category: "size", stages: ["pre-commit"] });
    addRule(db, {
      slug: "lint-b",
      name: "B",
      category: "size",
      stages: ["pre-commit", "pre-push"],
    });
    addRule(db, { slug: "lint-c", name: "C" }); // uncategorized, no stages
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
    // byStage counts rule_stages memberships (a rule counts once per stage); the
    // stage-less lint-c contributes nothing.
    expect(stats.byStage).toEqual({ "pre-commit": 2, "pre-push": 1 });
  });

  it("resolves byStage from rule_stages for bundled rules", () => {
    // Seeding writes each rule's meta.stages into rule_stages, so byStage carries
    // the concrete stages; multi-stage rules count once per stage.
    seed(db);
    const stats = getStats(db);
    expect(stats.byStage).toHaveProperty("pre-commit");
    expect(Object.values(stats.byStage).every((n) => n > 0)).toBe(true);
    const stagedTotal = Object.values(stats.byStage).reduce((a, b) => a + b, 0);
    expect(stagedTotal).toBeGreaterThanOrEqual(stats.total);
  });
});

describe("getMode", () => {
  const saved = process.env.CAPTAIN_OBVIOUS_MODE;
  afterEach(() => {
    if (saved === undefined) delete process.env.CAPTAIN_OBVIOUS_MODE;
    else process.env.CAPTAIN_OBVIOUS_MODE = saved;
  });

  it("echoes the resolved paths and the active mode", () => {
    process.env.CAPTAIN_OBVIOUS_MODE = "global";
    expect(getMode("/db/registry.db", "/db/audit.db")).toEqual({
      mode: "global",
      dbPath: "/db/registry.db",
      auditDbPath: "/db/audit.db",
    });
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

  it("sets the language set by diffing add/remove against current links", () => {
    addRule(db, { slug: "lint-pl", name: "PL", languages: ["typescript"] });
    // Adds csharp, drops typescript, keeps javascript unmentioned-but-added.
    const v = patchRule(db, "lint-pl", {
      languages: ["javascript", "csharp"],
    });
    expect([...v.languages].sort()).toEqual(["csharp", "javascript"]);
  });

  it("is a no-op when the desired language set already matches", () => {
    addRule(db, { slug: "lint-pl2", name: "PL2", languages: ["typescript"] });
    const v = patchRule(db, "lint-pl2", { languages: ["typescript"] });
    expect(v.languages).toEqual(["typescript"]);
  });

  it("clears all languages when given an empty set", () => {
    addRule(db, { slug: "lint-pl3", name: "PL3", languages: ["typescript"] });
    const v = patchRule(db, "lint-pl3", { languages: [] });
    expect(v.languages).toEqual([]);
  });

  it("sets the category set by diffing add/remove against current links", () => {
    addRule(db, { slug: "lint-pcat", name: "PCat", category: "size" });
    const v = patchRule(db, "lint-pcat", { categories: ["naming", "complexity"] });
    expect([...v.categories].sort()).toEqual(["complexity", "naming"]);
  });

  it("is a no-op when the desired category set already matches", () => {
    addRule(db, { slug: "lint-pcat2", name: "PCat2", category: "size" });
    const v = patchRule(db, "lint-pcat2", { categories: ["size"] });
    expect(v.categories).toEqual(["size"]);
  });

  it("replaces the stage set (canonical order) via setStages", () => {
    addRule(db, { slug: "lint-pst", name: "PSt", stages: ["pre-commit"] });
    const v = patchRule(db, "lint-pst", { stages: ["pre-push", "claude-tool"] });
    expect(v.stages).toEqual(["pre-push", "claude-tool"]);
    expect(v.stage).toBe("pre-push");
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

  it("exposes a rule's custom settingsControls (and [] when it has none)", () => {
    seed(db);
    const rules = listRules(db);
    const pp = rules.find((r) => r.slug === "lint-protected-paths");
    const note = rules.find((r) => r.slug === "gov-require-pr");
    const naming = rules.find((r) => r.slug === "lint-naming");
    expect(pp?.settingsControls).toEqual(["protected-paths"]);
    expect(note?.settingsControls).toEqual(["project-note"]);
    expect(naming?.settingsControls).toEqual([]);
  });

  it("maps a rule's declarative control and external deps into the view", () => {
    seed(db);
    const control = {
      kind: "declarative",
      fields: [{ key: "maxLines", label: "Max lines", type: "number", min: 1 }],
    };
    const deps = [{ kind: "npm", name: "prettier" }];
    db.prepare("UPDATE rules SET control_json = ?, deps_json = ? WHERE slug = ?").run(
      JSON.stringify(control),
      JSON.stringify(deps),
      "lint-max-lines",
    );
    const rule = listRules(db).find((r) => r.slug === "lint-max-lines");
    expect(rule?.control).toEqual(control);
    expect(rule?.deps).toEqual(deps);
    // A declarative control contributes no legacy custom-control keys.
    expect(rule?.settingsControls).toEqual([]);
  });
});

describe("listProjectRules / patchProjectRule overlay", () => {
  function projectView(projectId: number, slug: string) {
    const found = listProjectRules(db, projectId).find((r) => r.slug === slug);
    if (!found) throw new Error(`missing project rule view: ${slug}`);
    return found;
  }

  it("inherits global config and bindings until the project overrides them", () => {
    addRule(db, {
      slug: "lint-x",
      name: "X",
      languages: ["typescript"],
      config: JSON.stringify({ maxLines: 300 }),
    });
    configureRule(db, "lint-x", {
      setAction: { type: "halt", environment: null, delayMs: null },
    });
    configureRule(db, "lint-x", {
      setAction: { type: "warn", environment: "claude", delayMs: null },
    });
    const p = createProject(db, { name: "Proj" });

    const inherited = projectView(p.id, "lint-x");
    expect(inherited.config).toEqual({ maxLines: 300 });
    expect(inherited.defaultAction).toEqual({ type: "halt", delayMs: null });
    expect(inherited.envActions).toEqual([{ environment: "claude", type: "warn" }]);
  });

  it("overlays the project's config and fully replaces bindings once set", () => {
    addRule(db, {
      slug: "lint-y",
      name: "Y",
      languages: ["typescript"],
      config: JSON.stringify({ maxLines: 300 }),
    });
    configureRule(db, "lint-y", {
      setAction: { type: "warn", environment: "claude", delayMs: null },
    });
    const p = createProject(db, { name: "Proj" });

    patchProjectRule(db, p.id, "lint-y", {
      config: { maxLines: 40 },
      setAction: { type: "delay_halt", delayMs: 250 },
    });
    const v = projectView(p.id, "lint-y");
    expect(v.config).toEqual({ maxLines: 40 });
    // A single project binding replaces the whole global set, so the inherited
    // claude override is gone and the project default stands alone.
    expect(v.defaultAction).toEqual({ type: "delay_halt", delayMs: 250 });
    expect(v.envActions).toEqual([]);

    // Clearing the config override falls back to the global config.
    patchProjectRule(db, p.id, "lint-y", { config: null });
    expect(projectView(p.id, "lint-y").config).toEqual({ maxLines: 300 });
  });

  it("applies enabled, languages, and removeAction through the patch", () => {
    addRule(db, { slug: "lint-z", name: "Z", languages: ["typescript", "javascript"] });
    configureRule(db, "lint-z", {
      setAction: { type: "halt", environment: null, delayMs: null },
    });
    const p = createProject(db, { name: "Proj" });
    patchProjectRule(db, p.id, "lint-z", {
      setAction: { type: "warn", environment: "claude" },
    });

    const patched = patchProjectRule(db, p.id, "lint-z", {
      enabled: false,
      languages: ["javascript"],
      removeAction: "all",
    });
    expect(patched.enabled).toBe(false);
    expect(patched.languages).toEqual(["javascript"]);
    // removeAction "all" clears the project bindings, so it inherits global again.
    expect(patched.defaultAction).toEqual({ type: "halt", delayMs: null });
  });
});

describe("PANEL_EXT", () => {
  it("is a non-empty IIFE string the serve layer injects into the panel", () => {
    expect(typeof PANEL_EXT).toBe("string");
    expect(PANEL_EXT).toContain("/api/rules");
    expect(PANEL_EXT.trim().startsWith("(()")).toBe(true);
  });

  it("renders the Run/Activity/Settings actions column and settings dialog", () => {
    expect(PANEL_EXT).toContain('addHeader(headRow, "co-act-th"');
    expect(PANEL_EXT).toContain('data-act="run"');
    expect(PANEL_EXT).toContain('data-act="activity"');
    expect(PANEL_EXT).toContain('data-act="settings"');
    expect(PANEL_EXT).toContain("openRuleSettingsModal");
    expect(PANEL_EXT).toContain("<svg");
  });

  it("gives the Activity overlay the same full-screen base style as the Run overlay", () => {
    // Both overlay containers must share the fixed/inset/column base, or the
    // Activity overlay lays out as a row filling only part of the viewport.
    expect(PANEL_EXT).toContain(
      "#co-activity-overlay){position:fixed;inset:0;display:none;flex-direction:column",
    );
  });
});
