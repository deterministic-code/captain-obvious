import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { assertRulePlugin, loadPlugins } from "../load.js";
import type { RulePlugin } from "../plugin.js";

const here = dirname(fileURLToPath(import.meta.url));
const OK_ROOT = resolve(here, "fixtures", "plugins-ok");
const BAD_ROOT = resolve(here, "fixtures", "plugins-bad");
const CONFIG_ROOT = resolve(here, "fixtures", "plugins-config");
const BADCFG_ROOT = resolve(here, "fixtures", "plugins-badcfg");

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
  it("discovers plugin directories, skipping _shared and descriptor-less dirs", async () => {
    const plugins = await loadPlugins(OK_ROOT, OK_ROOT);
    expect(plugins.map((p) => p.meta.slug)).toEqual(["good-rule"]);
    expect(plugins[0].control).toEqual({
      kind: "declarative",
      fields: [{ key: "limit", label: "Limit", type: "number", min: 1 }],
    });
  });

  it("throws when a plugin's checkEntry does not exist", async () => {
    await expect(loadPlugins(BAD_ROOT, BAD_ROOT)).rejects.toThrow(
      /checkEntry not found/,
    );
  });

  it("returns an array for the default (bundled) rules root", async () => {
    expect(Array.isArray(await loadPlugins())).toBe(true);
  });

  it("loads a config plugins[] entry by local path and dedupes the folder scan", async () => {
    // dup-rule is both listed in the config and present as a folder dir; the config
    // entry wins and the folder scan skips the duplicate slug.
    const plugins = await loadPlugins(CONFIG_ROOT, CONFIG_ROOT);
    expect(plugins.map((p) => p.meta.slug)).toEqual(["dup-rule"]);
    expect(plugins[0].checkPath).toContain(`dup-rule${sep}check.mjs`);
  });

  it("ignores a plugins config that is not an array", async () => {
    expect(await loadPlugins(BADCFG_ROOT, BADCFG_ROOT)).toEqual([]);
  });

  it("throws on a config plugin whose descriptor is missing meta.slug", async () => {
    const NOSLUG_ROOT = resolve(here, "fixtures", "plugins-noslug");
    await expect(loadPlugins(NOSLUG_ROOT, NOSLUG_ROOT)).rejects.toThrow(
      /must match the directory name/,
    );
  });
});

describe("assertRulePlugin", () => {
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
    expect(() => assertRulePlugin(p, "r")).toThrow(/meta.stages must be an array/);
  });

  it("rejects an unknown stage", () => {
    const p = validPlugin();
    p.meta.stages = ["nope" as never];
    expect(() => assertRulePlugin(p, "r")).toThrow(/unknown stage/);
  });

  it("rejects a non-string, non-null checkEntry", () => {
    const p = validPlugin();
    (p as { checkEntry: unknown }).checkEntry = 7;
    expect(() => assertRulePlugin(p, "r")).toThrow(/checkEntry must be a string or null/);
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
