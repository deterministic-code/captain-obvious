/**
 * The control panel's "Run" backend: run a chosen set of rules against a folder
 * and return their violations as structured JSON. Rules ship as hooks that print
 * a human report and exit; here we spawn each with CO_JSON=1 so it emits one JSON
 * line of violations instead, and collect that. Display-only — no fixes applied.
 */
import { readFile, readdir } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";
import type { Db } from "../db/open.js";
import { RULES } from "../rules/index.js";
import { dispatchRule } from "../rules/runner.js";
import type { Violation } from "../rules/types.js";
import { repoRoot, resolveRunTarget } from "./target.js";
import { JS_TS_EXTS as LINTABLE_EXTS } from "../../lib/languages.mjs";

/** Directories the browser hides — build output, deps, VCS; dotfiles are skipped separately. */
export const HIDDEN_DIRS = new Set([
  "node_modules",
  "dist",
  "build",
  "target",
  "coverage",
]);

/**
 * Slugs whose hooks emit CO_JSON structured output in `--all` mode. Every rule
 * that supports a whole-folder scan is wired; the excluded few have no `--all`
 * runner (lint-comments, lint-tests-with-code, gov-*) or don't emit per-line
 * violations (lint-coverage reports regressions).
 */
export const RUNNABLE_SLUGS = [
  "lint-naming",
  "lint-emitter-casing",
  "lint-empty-tests",
  "lint-test-determinism",
  "lint-test-disabling-skipping",
  "lint-solid-s",
  "lint-solid-o",
  "lint-solid-l",
  "lint-solid-i",
  "lint-solid-d",
  "lint-complexity",
  "lint-max-lines",
  "lint-max-params",
  "lint-max-statements",
  "lint-dup",
  "lint-dup-fn",
  "lint-dup-structural",
  "lint-frozen-interfaces",
  "lint-empty-catch",
  "lint-sync-calls",
  "lint-prettier",
  "lint-dead-code",
] as const;

const RUNNABLE = new Set<string>(RUNNABLE_SLUGS);
const KNOWN = new Set(RULES.map((r) => r.meta.slug));

export interface RunRequest {
  slugs?: string[];
  path?: string;
}

export interface RunResult {
  slug: string;
  ok: boolean;
  violations: Violation[];
  error?: string;
}

export interface RunMeta {
  root: string;
  runnableSlugs: string[];
}

/** GET /api/run/meta — the default target folder + the slugs the Run tab may run. */
export async function runMeta(): Promise<RunMeta> {
  return { root: await repoRoot(), runnableSlugs: [...RUNNABLE_SLUGS] };
}

interface BrowseEntry {
  name: string;
  type: "dir" | "file";
  path: string;
}
export interface BrowseView {
  path: string;
  parent: string | null;
  entries: BrowseEntry[];
}

/**
 * GET /api/run/browse — list a directory's navigable subfolders and lintable
 * files, so the panel can pick a target from the server's filesystem (a browser
 * can't hand us a real path). Dirs first, then files, each alphabetical.
 */
export async function browse(rawPath?: string): Promise<BrowseView> {
  const path = rawPath?.trim() ? resolve(rawPath.trim()) : await repoRoot();
  const dirents = await readdir(path, { withFileTypes: true });
  const dirs: BrowseEntry[] = [];
  const files: BrowseEntry[] = [];
  for (const d of dirents) {
    if (d.isDirectory()) {
      if (d.name.startsWith(".") || HIDDEN_DIRS.has(d.name)) continue;
      dirs.push({ name: d.name, type: "dir", path: join(path, d.name) });
    } else if (d.isFile() && LINTABLE_EXTS.has(extname(d.name))) {
      files.push({ name: d.name, type: "file", path: join(path, d.name) });
    }
  }
  const byName = (a: BrowseEntry, b: BrowseEntry) =>
    a.name.localeCompare(b.name);
  const parent = dirname(path);
  return {
    path,
    parent: parent === path ? null : parent,
    entries: [...dirs.sort(byName), ...files.sort(byName)],
  };
}

export interface FileView {
  path: string;
  text: string;
}

/**
 * GET /api/run/file — read one lintable file's text for the Run tab's split
 * viewer, so clicking a violation can open the source and mark the line. Limited
 * to the extensions the hooks police, matching what `browse` offers as files.
 */
export async function readSource(rawPath?: string): Promise<FileView> {
  if (!rawPath?.trim()) throw new Error("path is required");
  const path = resolve(await repoRoot(), rawPath.trim());
  if (!LINTABLE_EXTS.has(extname(path))) {
    throw new Error(`not a viewable file: ${path}`);
  }
  const text = await readFile(path, "utf8");
  return { path, text };
}

/**
 * Run one rule in JSON mode through the single runner (so the scan is logged like
 * every other rule run) and shape its outcome into a RunResult. A non-runnable or
 * unknown slug, a spawn failure, or a hook that emitted no `{"violations":[…]}`
 * line all surface as an error result the panel renders per-rule (never a throw
 * that would fail the whole request).
 */
async function runOne(
  auditDb: Db,
  slug: string,
  cwd: string,
  modeArgs: string[],
): Promise<RunResult> {
  if (!KNOWN.has(slug)) {
    return { slug, ok: false, violations: [], error: "unknown rule" };
  }
  if (!RUNNABLE.has(slug)) {
    return {
      slug,
      ok: false,
      violations: [],
      error: "rule is not runnable from the panel yet",
    };
  }
  try {
    const outcome = await dispatchRule(auditDb, {
      slug,
      stage: "run",
      cwd,
      args: modeArgs,
      mode: "json",
    });
    if (outcome.violations === null) {
      return {
        slug,
        ok: false,
        violations: [],
        error:
          outcome.stderr || `exited ${outcome.code} without JSON output`,
      };
    }
    return { slug, ok: true, violations: outcome.violations };
  } catch (e) {
    return { slug, ok: false, violations: [], error: (e as Error).message };
  }
}

/** Run each slug against `cwd` with a small pool — the rules re-scan the whole tree, so don't unbounded-fan-out. */
export async function mapPool<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => worker()),
  );
  return results;
}

/**
 * POST /api/run — run the requested rules against `path`. A folder runs every
 * rule over its whole tree (`--all`); a single file runs them over just that
 * file (`--files`). Results keep request order.
 */
export async function runRules(
  auditDb: Db,
  body: RunRequest,
): Promise<RunResult[]> {
  const requested = body.slugs;
  if (!Array.isArray(requested) || requested.length === 0) {
    throw new Error("slugs is required");
  }
  const { cwd, modeArgs } = await resolveRunTarget(body.path);
  const slugs = [...new Set(requested)];
  return mapPool(slugs, 4, (slug) => runOne(auditDb, slug, cwd, modeArgs));
}

/**
 * Run one rule over a single file and return its result. The AI-fix flow uses
 * this to get authoritative, fresh violations for the file it's about to fix,
 * rather than trusting whatever the panel last rendered.
 */
export async function runRuleOnFile(
  auditDb: Db,
  slug: string,
  file: string,
): Promise<RunResult> {
  const { cwd, modeArgs } = await resolveRunTarget(file);
  return runOne(auditDb, slug, cwd, modeArgs);
}
