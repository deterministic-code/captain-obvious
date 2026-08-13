import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  assertRulePlugin,
  discoverInstalledPlugins,
  discoverRules,
  installedRulePackages,
  loadPlugins,
  nodeModulesRoots,
} from "../load.js";
import type { RulePlugin } from "../plugin.js";

const here = dirname(fileURLToPath(import.meta.url));
const OK_ROOT = resolve(here, "fixtures", "plugins-ok");
const BAD_ROOT = resolve(here, "fixtures", "plugins-bad");
const NOSLUG_ROOT = resolve(here, "fixtures", "plugins-noslug");
const NM = resolve(here, "fixtures", "node-modules");
const NM_OK = resolve(NM, "nm-ok");
const NM_VERSIONS = resolve(NM, "nm-versions");

/** A structurally valid descriptor; tests mutate a clone to hit each branch. */
function validPlugin(): RulePlugin {
  return {
    meta: {
      slug: "r",
      name: "R",
      category: "governance",
      description: "d",
      languages: [],
      config: null,
      ratchetable: false,
      modes: ["staged"],
      stages: ["pre-commit"],
    },
    control: { kind: "declarative", fields: [] },
    checkEntry: "r/check.mjs",
  };
}

describe("loadPlugins", () => {
  it("discovers plugin dirs, skipping _shared, descriptor-less, and stray files", async () => {
    const plugins = await loadPlugins(OK_ROOT);
    expect(plugins.map((p) => p.meta.slug)).toEqual(["good-rule"]);
    expect(plugins[0].control).toEqual({
      kind: "declarative",
      fields: [{ key: "limit", label: "Limit", type: "number", min: 1 }],
    });
  });

  it("throws when a plugin's checkEntry does not exist", async () => {
    await expect(loadPlugins(BAD_ROOT)).rejects.toThrow(/checkEntry not found/);
  });

  it("returns an array for the default (bundled) rules root", async () => {
    expect(Array.isArray(await loadPlugins())).toBe(true);
  });

  it("throws when a folder's descriptor has no string slug", async () => {
    await expect(loadPlugins(NOSLUG_ROOT)).rejects.toThrow(
      /meta\.slug must be a string/,
    );
  });

  it("returns no rules when the rules dir is absent", async () => {
    const missing = resolve(here, "fixtures", "does-not-exist");
    expect(await loadPlugins(missing)).toEqual([]);
  });

  it("rethrows a non-ENOENT readdir error when the root is a file", async () => {
    const file = resolve(OK_ROOT, "stray.txt");
    await expect(loadPlugins(file)).rejects.toThrow();
  });
});

describe("nodeModulesRoots", () => {
  it("collects every node_modules ancestor of the module path", () => {
    expect(
      nodeModulesRoots("/proj/node_modules/@scope/pkg/dist/rules/load.js"),
    ).toEqual(["/proj/node_modules"]);
  });

  it("returns [] when no ancestor is a node_modules dir", () => {
    expect(nodeModulesRoots("/proj/src/rules/load.js")).toEqual([]);
  });

  it("defaults to this module's own resolution path", () => {
    expect(Array.isArray(nodeModulesRoots())).toBe(true);
  });
});

describe("discoverInstalledPlugins", () => {
  it("finds keyworded packages across scopes, skipping non-rules and stray entries", async () => {
    const plugins = await discoverInstalledPlugins([NM_OK]);
    expect(plugins.map((p) => p.meta.slug).sort()).toEqual([
      "alpha",
      "beta",
      "good-rule",
    ]);
    const alpha = plugins.find((p) => p.meta.slug === "alpha");
    expect(alpha?.checkPath).toMatch(/co-rule-alpha\/check\.mjs$/);
  });

  it("returns [] for a node_modules root that does not exist", async () => {
    expect(await discoverInstalledPlugins([resolve(NM, "nope")])).toEqual([]);
  });

  it("throws when a keyworded package is missing its descriptor", async () => {
    await expect(
      discoverInstalledPlugins([resolve(NM, "nm-broken")]),
    ).rejects.toThrow();
  });

  it("throws when a keyworded descriptor omits meta.slug", async () => {
    await expect(
      discoverInstalledPlugins([resolve(NM, "nm-noslug")]),
    ).rejects.toThrow(/meta\.slug must be a string/);
  });

  it("defaults to the real node_modules roots", async () => {
    expect(Array.isArray(await discoverInstalledPlugins())).toBe(true);
  });
});

describe("installedRulePackages", () => {
  it("returns name+version for keyworded packages with both fields, skipping the rest", async () => {
    expect(await installedRulePackages([NM_VERSIONS])).toEqual([
      { name: "co-rule-good", version: "1.0.0" },
    ]);
  });

  it("defaults to the real node_modules roots", async () => {
    expect(Array.isArray(await installedRulePackages())).toBe(true);
  });
});

describe("discoverRules", () => {
  it("unions installed packages with the local scan, the local folder winning a slug clash", async () => {
    const rules = await discoverRules([NM_OK], OK_ROOT);
    expect(rules.map((r) => r.meta.slug)).toEqual([
      "alpha",
      "beta",
      "good-rule",
    ]);
    const good = rules.find((r) => r.meta.slug === "good-rule");
    expect(good?.checkPath).toContain("plugins-ok");
  });

  it("returns an array for the default roots", async () => {
    expect(Array.isArray(await discoverRules())).toBe(true);
  });
});

describe("assertRulePlugin", () => {
  it("accepts an installed descriptor (null expectedSlug) by its own slug", () => {
    const p = validPlugin();
    expect(assertRulePlugin(p, null)).toBe(p);
  });

  it("rejects a non-string slug", () => {
    const p = validPlugin();
    (p.meta as { slug: unknown }).slug = 7;
    expect(() => assertRulePlugin(p, "r")).toThrow(
      /meta.slug must be a string/,
    );
  });

  it("accepts a valid declarative plugin and returns it", () => {
    const p = validPlugin();
    expect(assertRulePlugin(p, "r")).toBe(p);
  });

  it("accepts a custom control and a null checkEntry", () => {
    const p = validPlugin();
    p.control = { kind: "custom", key: "protected-paths" };
    p.checkEntry = null;
    expect(() => assertRulePlugin(p, "r")).not.toThrow();
  });

  it("accepts a plugin with no control", () => {
    const p = validPlugin();
    delete p.control;
    expect(() => assertRulePlugin(p, "r")).not.toThrow();
  });

  it.each([
    ["null", null, "r", /must default-export/],
    ["non-object", "nope", "r", /must default-export/],
  ])("rejects a %s descriptor", (_label, value, slug, re) => {
    expect(() => assertRulePlugin(value, slug as string)).toThrow(re as RegExp);
  });

  it("rejects a missing meta", () => {
    expect(() => assertRulePlugin({}, "r")).toThrow(/plugin.meta is required/);
  });

  it("rejects a null meta", () => {
    expect(() => assertRulePlugin({ meta: null }, "r")).toThrow(
      /plugin.meta is required/,
    );
  });

  it("rejects a slug that disagrees with the directory name", () => {
    expect(() => assertRulePlugin(validPlugin(), "other")).toThrow(
      /must match the directory name/,
    );
  });

  it("rejects non-array stages", () => {
    const p = validPlugin();
    (p.meta as { stages: unknown }).stages = "pre-commit";
    expect(() => assertRulePlugin(p, "r")).toThrow(
      /meta.stages must be an array/,
    );
  });

  it("rejects an unknown stage", () => {
    const p = validPlugin();
    p.meta.stages = ["nope" as never];
    expect(() => assertRulePlugin(p, "r")).toThrow(/unknown stage/);
  });

  it("accepts a supportStages superset of stages", () => {
    const p = validPlugin();
    p.meta.stages = ["pre-commit" as never];
    (p.meta as { supportStages?: string[] }).supportStages = [
      "pre-commit",
      "pre-push",
      "tool",
    ];
    expect(() => assertRulePlugin(p, "r")).not.toThrow();
  });

  it("rejects non-array supportStages", () => {
    const p = validPlugin();
    (p.meta as { supportStages: unknown }).supportStages = "pre-commit";
    expect(() => assertRulePlugin(p, "r")).toThrow(
      /meta.supportStages must be an array/,
    );
  });

  it("rejects an unknown supportStages slug", () => {
    const p = validPlugin();
    (p.meta as { supportStages: string[] }).supportStages = ["nope"];
    expect(() => assertRulePlugin(p, "r")).toThrow(/unknown stage/);
  });

  it("rejects a stage not contained in supportStages", () => {
    const p = validPlugin();
    p.meta.stages = ["pre-push" as never];
    (p.meta as { supportStages: string[] }).supportStages = ["pre-commit"];
    expect(() => assertRulePlugin(p, "r")).toThrow(
      /stage "pre-push" is not in supportStages/,
    );
  });

  it("accepts a string defaultAction", () => {
    const p = validPlugin();
    (p.meta as { defaultAction?: string }).defaultAction = "warn";
    expect(() => assertRulePlugin(p, "r")).not.toThrow();
  });

  it("rejects a non-string defaultAction", () => {
    const p = validPlugin();
    (p.meta as { defaultAction: unknown }).defaultAction = 7;
    expect(() => assertRulePlugin(p, "r")).toThrow(
      /meta.defaultAction must be a string/,
    );
  });

  it("rejects a non-string, non-null checkEntry", () => {
    const p = validPlugin();
    (p as { checkEntry: unknown }).checkEntry = 7;
    expect(() => assertRulePlugin(p, "r")).toThrow(
      /checkEntry must be a string or null/,
    );
  });

  it("rejects a non-object control", () => {
    const p = validPlugin();
    (p as { control: unknown }).control = "declarative";
    expect(() => assertRulePlugin(p, "r")).toThrow(/control must be an object/);
  });

  it("rejects a declarative control without a fields array", () => {
    const p = validPlugin();
    (p as { control: unknown }).control = { kind: "declarative" };
    expect(() => assertRulePlugin(p, "r")).toThrow(/needs a fields array/);
  });

  it("rejects a custom control without a string key", () => {
    const p = validPlugin();
    (p as { control: unknown }).control = { kind: "custom" };
    expect(() => assertRulePlugin(p, "r")).toThrow(/needs a string key/);
  });

  it("rejects an unknown control kind", () => {
    const p = validPlugin();
    (p as { control: unknown }).control = { kind: "weird" };
    expect(() => assertRulePlugin(p, "r")).toThrow(/control.kind must be/);
  });
});
