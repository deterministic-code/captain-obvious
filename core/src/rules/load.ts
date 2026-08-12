import { access, readFile, readdir } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { requireStage } from "./stages.js";
import type { ControlSpec, RulePlugin } from "./plugin.js";

/** Core package root: two levels up from this module (src/rules or dist/rules). */
const pkgRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
/** Monorepo root — the core's parent; rule packages live under repoRoot/rules. */
const repoRoot = resolve(pkgRoot, "..");
const RULES_DIR = resolve(repoRoot, "rules");

/** The npm keyword an installed package declares to opt into rule discovery. */
export const RULE_KEYWORD = "captain-obvious-rule";

const exists = (p: string): Promise<boolean> =>
  access(p).then(
    () => true,
    () => false,
  );

/** readdir that yields `[]` for an absent dir but rethrows every other error. */
const readEntries = (p: string) =>
  readdir(p, { withFileTypes: true }).catch((err: NodeJS.ErrnoException) => {
    if (err.code === "ENOENT") return [];
    throw err;
  });

/**
 * Import a rule descriptor from `<dir>/plugin.mjs`, validate it, and stamp an
 * absolute `checkPath` resolved against `dir`. `expectedSlug` enforces the
 * folder-scan invariant that a rule's slug matches its directory; pass `null` for
 * an installed package, where the package name differs from the slug and the
 * descriptor's own `meta.slug` is authoritative. A missing runner fails loudly.
 */
async function loadDescriptor(
  dir: string,
  expectedSlug: string | null,
): Promise<RulePlugin> {
  const descriptor = resolve(dir, "plugin.mjs");
  const mod = (await import(pathToFileURL(descriptor).href)) as {
    default?: unknown;
  };
  const plugin = assertRulePlugin(mod.default, expectedSlug);
  const checkPath =
    plugin.checkEntry === null ? null : resolve(dir, plugin.checkEntry);
  if (checkPath !== null && !(await exists(checkPath))) {
    throw new Error(
      `rule ${plugin.meta.slug}: checkEntry not found: ${plugin.checkEntry}`,
    );
  }
  return { ...plugin, checkPath };
}

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
  const slugs = (await readEntries(root))
    .filter((e) => e.isDirectory() && !e.name.startsWith("_"))
    .map((e) => e.name)
    .sort();

  const out: RulePlugin[] = [];
  for (const slug of slugs) {
    if (!(await exists(resolve(root, slug, "plugin.mjs")))) continue;
    out.push(await loadDescriptor(resolve(root, slug), slug));
  }
  return out.sort((a, b) => a.meta.slug.localeCompare(b.meta.slug));
}

/**
 * The `node_modules` directories on this module's resolution path — every ancestor
 * named `node_modules`. Empty in the monorepo (core is a source package, not itself
 * under `node_modules`), non-empty exactly when core is installed as a dependency,
 * which is when its sibling rule packages need discovering. `start` overridable for
 * tests.
 */
export function nodeModulesRoots(
  start: string = fileURLToPath(import.meta.url),
): string[] {
  const roots: string[] = [];
  let dir = resolve(start);
  for (let parent = dirname(dir); parent !== dir; parent = dirname(dir)) {
    if (basename(parent) === "node_modules") roots.push(parent);
    dir = parent;
  }
  return roots;
}

/** Every installed package directory under a `node_modules` root, scopes flattened. */
async function packageDirs(nodeModules: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readEntries(nodeModules)) {
    if (entry.name.startsWith(".")) continue;
    if (entry.name.startsWith("@")) {
      const scope = resolve(nodeModules, entry.name);
      for (const pkg of await readEntries(scope)) {
        if (!pkg.name.startsWith(".")) out.push(resolve(scope, pkg.name));
      }
    } else {
      out.push(resolve(nodeModules, entry.name));
    }
  }
  return out;
}

interface RuleManifest {
  name?: string;
  version?: string;
  keywords?: unknown;
}

/** Parsed package.json of the rule package at `dir` if it opts in via {@link RULE_KEYWORD}, else null. */
async function readRuleManifest(dir: string): Promise<RuleManifest | null> {
  const manifest = resolve(dir, "package.json");
  if (!(await exists(manifest))) return null;
  const pkg = JSON.parse(await readFile(manifest, "utf8")) as RuleManifest;
  if (!Array.isArray(pkg.keywords) || !pkg.keywords.includes(RULE_KEYWORD)) {
    return null;
  }
  return pkg;
}

/** A `RulePlugin` from a package that opts in via {@link RULE_KEYWORD}, else null. */
async function ruleFromPackage(dir: string): Promise<RulePlugin | null> {
  return (await readRuleManifest(dir)) === null ? null : loadDescriptor(dir, null);
}

export interface InstalledRulePackage {
  name: string;
  version: string;
}

/**
 * Name + version of every installed rule package (keyword opt-in) — the input to the
 * install-time engine/rules version-skew check. Distinct from {@link discoverInstalledPlugins}:
 * it needs the manifest's version, not a validated descriptor. `roots` is overridable for tests.
 */
export async function installedRulePackages(
  roots: string[] = nodeModulesRoots(),
): Promise<InstalledRulePackage[]> {
  const out: InstalledRulePackage[] = [];
  for (const nodeModules of roots) {
    for (const dir of await packageDirs(nodeModules)) {
      const pkg = await readRuleManifest(dir);
      if (
        pkg !== null &&
        typeof pkg.name === "string" &&
        typeof pkg.version === "string"
      ) {
        out.push({ name: pkg.name, version: pkg.version });
      }
    }
  }
  return out;
}

/**
 * Discover rule plugins installed as npm packages: scan each `node_modules` root for
 * packages that opt in via the {@link RULE_KEYWORD} keyword and load their descriptor.
 * This is the delivery path for a consuming repo, where rules are separate packages —
 * of any name or scope, including third-party — rather than folders in this tree.
 * `roots` is overridable for tests.
 */
export async function discoverInstalledPlugins(
  roots: string[] = nodeModulesRoots(),
): Promise<RulePlugin[]> {
  const out: RulePlugin[] = [];
  for (const nodeModules of roots) {
    for (const dir of await packageDirs(nodeModules)) {
      const plugin = await ruleFromPackage(dir);
      if (plugin !== null) out.push(plugin);
    }
  }
  return out;
}

/**
 * The full rule set feeding `seed-rules` and the dispatcher: installed rule packages
 * (consumer install) unioned with the in-repo `rules/<slug>/` folder scan (monorepo
 * dogfooding). On a slug clash the local folder wins, so the repo runs its own copy.
 * `roots`/`localRoot` are overridable for tests.
 */
export async function discoverRules(
  roots: string[] = nodeModulesRoots(),
  localRoot: string = RULES_DIR,
): Promise<RulePlugin[]> {
  const bySlug = new Map<string, RulePlugin>();
  for (const p of await discoverInstalledPlugins(roots))
    bySlug.set(p.meta.slug, p);
  for (const p of await loadPlugins(localRoot)) bySlug.set(p.meta.slug, p);
  return [...bySlug.values()].sort((a, b) =>
    a.meta.slug.localeCompare(b.meta.slug),
  );
}

/**
 * Validate a plugin descriptor's shape, throwing `rule <slug>: <reason>` on the
 * errors that would otherwise pass silently — a non-string or (for a folder scan)
 * mismatched slug, an unknown stage, or a malformed checkEntry/control. Pass
 * `expectedSlug: null` for an installed package, where the package name differs
 * from the slug so only `meta.slug`'s own well-formedness is enforced. Fields the
 * DB layer rejects on its own (missing name/description) are left to fail there.
 */
export function assertRulePlugin(
  value: unknown,
  expectedSlug: string | null,
): RulePlugin {
  const label = expectedSlug ?? "installed rule";
  if (typeof value !== "object" || value === null) {
    throw new Error(
      `rule ${label}: plugin.mjs must default-export a RulePlugin object`,
    );
  }
  const plugin = value as Record<string, unknown>;
  const meta = plugin.meta;
  if (typeof meta !== "object" || meta === null) {
    throw new Error(`rule ${label}: plugin.meta is required`);
  }
  const m = meta as Record<string, unknown>;
  if (typeof m.slug !== "string") {
    throw new Error(`rule ${label}: meta.slug must be a string`);
  }
  if (expectedSlug !== null && m.slug !== expectedSlug) {
    throw new Error(
      `rule ${expectedSlug}: meta.slug is ${JSON.stringify(m.slug)}, must match the directory name`,
    );
  }
  if (!Array.isArray(m.stages)) {
    throw new Error(`rule ${label}: meta.stages must be an array`);
  }
  for (const stage of m.stages) requireStage(String(stage));

  if (m.defaultAction !== undefined && typeof m.defaultAction !== "string") {
    throw new Error(`rule ${label}: meta.defaultAction must be a string`);
  }

  const { checkEntry, control } = plugin;
  if (checkEntry !== null && typeof checkEntry !== "string") {
    throw new Error(`rule ${label}: checkEntry must be a string or null`);
  }
  if (control !== undefined) assertControl(control, label);
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
