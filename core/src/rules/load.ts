import { access, readdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { requireStage } from "./stages.js";
import type { ControlSpec, RulePlugin } from "./plugin.js";

/** Core package root: two levels up from this module (src/rules or dist/rules). */
const pkgRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
/** Monorepo root — the core's parent; rule packages live under repoRoot/rules. */
const repoRoot = resolve(pkgRoot, "..");
const RULES_DIR = resolve(repoRoot, "rules");

const exists = (p: string): Promise<boolean> =>
  access(p).then(
    () => true,
    () => false,
  );

/**
 * Discover every rule plugin by scanning `rules/<slug>/` for a `plugin.mjs`, skipping
 * `_`-prefixed shared dirs (e.g. `_kit`). The registry DB, seeded from these, is the
 * single source of truth for the rule set — there is no config list to keep in sync.
 * Each descriptor is validated and its check runner confirmed to exist; the loader
 * stamps an absolute `checkPath` by resolving `checkEntry` against the rule's own
 * directory, so a mistyped slug or missing runner fails the load loudly. A missing
 * `rules/` dir yields no rules rather than throwing; `root` is overridable for tests.
 */
export async function loadPlugins(
  root: string = RULES_DIR,
): Promise<RulePlugin[]> {
  const entries = await readdir(root, { withFileTypes: true }).catch(
    (err: NodeJS.ErrnoException) => {
      if (err.code === "ENOENT") return [];
      throw err;
    },
  );
  const slugs = entries
    .filter((e) => e.isDirectory() && !e.name.startsWith("_"))
    .map((e) => e.name)
    .sort();

  const out: RulePlugin[] = [];
  for (const slug of slugs) {
    const descriptor = resolve(root, slug, "plugin.mjs");
    if (!(await exists(descriptor))) continue;
    const mod = (await import(pathToFileURL(descriptor).href)) as {
      default?: unknown;
    };
    const plugin = assertRulePlugin(mod.default, slug);
    const checkPath =
      plugin.checkEntry === null
        ? null
        : resolve(root, slug, plugin.checkEntry);
    if (checkPath !== null && !(await exists(checkPath))) {
      throw new Error(
        `rule ${plugin.meta.slug}: checkEntry not found: ${plugin.checkEntry}`,
      );
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
    throw new Error(
      `rule ${slug}: plugin.mjs must default-export a RulePlugin object`,
    );
  }
  const plugin = value as Record<string, unknown>;
  const meta = plugin.meta;
  if (typeof meta !== "object" || meta === null) {
    throw new Error(`rule ${slug}: plugin.meta is required`);
  }
  const m = meta as Record<string, unknown>;
  if (m.slug !== slug) {
    throw new Error(
      `rule ${slug}: meta.slug is ${JSON.stringify(m.slug)}, must match the directory name`,
    );
  }
  if (!Array.isArray(m.stages)) {
    throw new Error(`rule ${slug}: meta.stages must be an array`);
  }
  for (const stage of m.stages) requireStage(String(stage));

  if (m.defaultAction !== undefined && typeof m.defaultAction !== "string") {
    throw new Error(`rule ${slug}: meta.defaultAction must be a string`);
  }

  const { checkEntry, control } = plugin;
  if (checkEntry !== null && typeof checkEntry !== "string") {
    throw new Error(`rule ${slug}: checkEntry must be a string or null`);
  }
  if (control !== undefined) assertControl(control, slug);
  return plugin as unknown as RulePlugin;
}

function assertControl(
  control: unknown,
  slug: string,
): asserts control is ControlSpec {
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
  throw new Error(
    `rule ${slug}: control.kind must be "declarative" or "custom"`,
  );
}
