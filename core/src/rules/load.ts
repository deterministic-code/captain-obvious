import { access, readdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { requireStage } from "./stages.js";
import type { ControlSpec, RulePlugin } from "./plugin.js";

const require = createRequire(import.meta.url);

/** Core package root: two levels up from this module (src/rules or dist/rules). */
const pkgRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
/** Monorepo root — the core's parent; rule packages live under repoRoot/rules. */
const repoRoot = resolve(pkgRoot, "..");
const RULES_DIR = resolve(repoRoot, "rules");

const exists = (p: string): Promise<boolean> =>
  access(p).then(() => true, () => false);

interface Discovered {
  plugin: RulePlugin;
  /** Base directory the plugin's `checkEntry` resolves against. */
  dir: string;
}

/** The `plugins: [...]` entries from captain-obvious.config.json (or [] if absent). */
async function readPluginEntries(configDir: string): Promise<string[]> {
  const path = resolve(configDir, "captain-obvious.config.json");
  if (!(await exists(path))) return [];
  const cfg = JSON.parse(await readFile(path, "utf8")) as { plugins?: unknown };
  return Array.isArray(cfg.plugins) ? (cfg.plugins as string[]) : [];
}

/** Resolve a `plugins[]` entry — an npm package name or a local path — to its descriptor. */
async function resolveEntry(entry: string, configDir: string): Promise<Discovered> {
  const descriptor =
    entry.startsWith(".") || entry.startsWith("/")
      ? resolve(configDir, entry, "plugin.mjs")
      : require.resolve(`${entry}/plugin.mjs`);
  const mod = (await import(pathToFileURL(descriptor).href)) as { default?: unknown };
  const slug = (mod.default as { meta?: { slug?: unknown } })?.meta?.slug;
  return {
    plugin: assertRulePlugin(mod.default, typeof slug === "string" ? slug : entry),
    dir: dirname(descriptor),
  };
}

/**
 * Discover every rule plugin: the packages listed in `plugins[]`
 * (captain-obvious.config.json, an npm name or a local path), plus any not-yet-
 * packaged rule under `rules/<slug>/` (folder-scan, skipping dirs that carry their
 * own package.json — those arrive via the config list). Each descriptor is
 * validated and its check runner confirmed to exist; the loader stamps an absolute
 * `checkPath` by resolving `checkEntry` against the plugin's own directory, so a
 * mistyped slug or missing runner fails the load loudly. `configDir`/`root` are
 * overridable for tests.
 */
export async function loadPlugins(
  root: string = RULES_DIR,
  configDir: string = repoRoot,
): Promise<RulePlugin[]> {
  const bySlug = new Map<string, Discovered>();

  for (const entry of await readPluginEntries(configDir)) {
    const d = await resolveEntry(entry, configDir);
    bySlug.set(d.plugin.meta.slug, d);
  }

  const entries = await readdir(root, { withFileTypes: true });
  const slugs = entries
    .filter((e) => e.isDirectory() && !e.name.startsWith("_"))
    .map((e) => e.name)
    .sort();
  for (const slug of slugs) {
    if (await exists(resolve(root, slug, "package.json"))) continue;
    const descriptor = resolve(root, slug, "plugin.mjs");
    if (!(await exists(descriptor))) continue;
    const mod = (await import(pathToFileURL(descriptor).href)) as { default?: unknown };
    const plugin = assertRulePlugin(mod.default, slug);
    if (!bySlug.has(plugin.meta.slug)) {
      bySlug.set(plugin.meta.slug, { plugin, dir: resolve(root, slug) });
    }
  }

  const out: RulePlugin[] = [];
  for (const { plugin, dir } of bySlug.values()) {
    const checkPath = plugin.checkEntry === null ? null : resolve(dir, plugin.checkEntry);
    if (checkPath !== null && !(await exists(checkPath))) {
      throw new Error(`rule ${plugin.meta.slug}: checkEntry not found: ${plugin.checkEntry}`);
    }
    out.push({ ...plugin, checkPath });
  }
  return out.sort((a, b) => a.meta.slug.localeCompare(b.meta.slug));
}

/**
 * Validate a plugin descriptor's shape, throwing `rule <slug>: <reason>` on the
 * errors that would otherwise pass silently — a slug that disagrees with its
 * directory, an unknown stage, or a malformed checkEntry/control. Fields the DB
 * layer rejects on its own (missing name/description) are left to fail there.
 */
export function assertRulePlugin(value: unknown, slug: string): RulePlugin {
  if (typeof value !== "object" || value === null) {
    throw new Error(`rule ${slug}: plugin.mjs must default-export a RulePlugin object`);
  }
  const plugin = value as Record<string, unknown>;
  const meta = plugin.meta;
  if (typeof meta !== "object" || meta === null) {
    throw new Error(`rule ${slug}: plugin.meta is required`);
  }
  const m = meta as Record<string, unknown>;
  if (m.slug !== slug) {
    throw new Error(`rule ${slug}: meta.slug is ${JSON.stringify(m.slug)}, must match the directory name`);
  }
  if (!Array.isArray(m.stages)) {
    throw new Error(`rule ${slug}: meta.stages must be an array`);
  }
  for (const stage of m.stages) requireStage(String(stage));

  const { checkEntry, control } = plugin;
  if (checkEntry !== null && typeof checkEntry !== "string") {
    throw new Error(`rule ${slug}: checkEntry must be a string or null`);
  }
  if (control !== undefined) assertControl(control, slug);
  return plugin as unknown as RulePlugin;
}

function assertControl(control: unknown, slug: string): asserts control is ControlSpec {
  if (typeof control !== "object" || control === null) {
    throw new Error(`rule ${slug}: control must be an object`);
  }
  const c = control as Record<string, unknown>;
  if (c.kind === "declarative") {
    if (!Array.isArray(c.fields)) {
      throw new Error(`rule ${slug}: declarative control needs a fields array`);
    }
    return;
  }
  if (c.kind === "custom") {
    if (typeof c.key !== "string") {
      throw new Error(`rule ${slug}: custom control needs a string key`);
    }
    return;
  }
  throw new Error(`rule ${slug}: control.kind must be "declarative" or "custom"`);
}
