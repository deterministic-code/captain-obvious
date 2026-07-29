/**
 * The control panel's "Run" backend: run a chosen set of rules against a folder
 * and return their violations as structured JSON. Rules ship as hooks that print
 * a human report and exit; here we spawn each with CO_JSON=1 so it emits one JSON
 * line of violations instead, and collect that. Display-only — no fixes applied.
 */
import { execFile, spawn } from "node:child_process";
import { readFile, readdir, stat } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { hookScriptPath } from "../rules/dispatch.js";
import { RULES } from "../rules/index.js";
import type { Violation } from "../rules/types.js";
import { JS_TS_EXTS as LINTABLE_EXTS } from "../../lib/languages.mjs";

const execFileAsync = promisify(execFile);

/** Directories the browser hides — build output, deps, VCS; dotfiles are skipped separately. */
const HIDDEN_DIRS = new Set([
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
export function runMeta(): RunMeta {
  return { root: process.cwd(), runnableSlugs: [...RUNNABLE_SLUGS] };
}

export interface BrowseEntry {
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
  const path = rawPath?.trim() ? resolve(rawPath.trim()) : process.cwd();
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
  const byName = (a: BrowseEntry, b: BrowseEntry) => a.name.localeCompare(b.name);
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
  const path = resolve(rawPath.trim());
  if (!LINTABLE_EXTS.has(extname(path))) {
    throw new Error(`not a viewable file: ${path}`);
  }
  const text = await readFile(path, "utf8");
  return { path, text };
}

/** Throw a clean 400-worthy error unless `path` is inside a git work tree (the `--all` hooks need `git ls-files`). */
async function assertGitRepo(path: string): Promise<void> {
  await execFileAsync("git", [
    "-C",
    path,
    "rev-parse",
    "--is-inside-work-tree",
  ]).catch(() => {
    throw new Error(`not a git repository (or missing folder): ${path}`);
  });
}

function errResult(slug: string, stderr: string, code: number | null): RunResult {
  return {
    slug,
    ok: false,
    violations: [],
    error: stderr.trim() || `exited ${code} without JSON output`,
  };
}

/** Parse a `{"violations":[...]}` line; null when it isn't that shape (surfaced as an error upstream). */
function parseViolations(line: string): Violation[] | null {
  // A non-JSON line means the hook didn't emit structured output — signal null, reported as an error.
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return null;
  }
  const violations = (value as { violations?: unknown } | null)?.violations;
  return Array.isArray(violations) ? (violations as Violation[]) : null;
}

/** Spawn one rule's hook in JSON mode with `modeArgs` against `cwd` and collect its violations. */
function runRuleCollect(
  slug: string,
  cwd: string,
  modeArgs: string[],
): Promise<RunResult> {
  const child = spawn(process.execPath, [hookScriptPath(slug), ...modeArgs], {
    cwd,
    env: { ...process.env, CO_JSON: "1" },
  });
  return new Promise((resolvePromise) => {
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) =>
      resolvePromise({ slug, ok: false, violations: [], error: e.message }),
    );
    child.on("close", (code) => {
      const line = out.trim().split("\n").filter(Boolean).pop();
      const violations = code === 0 && line ? parseViolations(line) : null;
      if (violations === null) return resolvePromise(errResult(slug, err, code));
      resolvePromise({ slug, ok: true, violations });
    });
  });
}

function runOne(slug: string, cwd: string, modeArgs: string[]): Promise<RunResult> {
  if (!KNOWN.has(slug)) {
    return Promise.resolve({ slug, ok: false, violations: [], error: "unknown rule" });
  }
  if (!RUNNABLE.has(slug)) {
    return Promise.resolve({
      slug,
      ok: false,
      violations: [],
      error: "rule is not runnable from the panel yet",
    });
  }
  return runRuleCollect(slug, cwd, modeArgs);
}

/** Run each slug against `cwd` with a small pool — the rules re-scan the whole tree, so don't unbounded-fan-out. */
async function mapPool<T, R>(
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
export async function runRules(body: RunRequest): Promise<RunResult[]> {
  const requested = body.slugs;
  if (!Array.isArray(requested) || requested.length === 0) {
    throw new Error("slugs is required");
  }
  const target = body.path?.trim() ? resolve(body.path.trim()) : process.cwd();
  const info = await stat(target).catch(() => {
    throw new Error(`no such file or folder: ${target}`);
  });
  const isDir = info.isDirectory();
  const cwd = isDir ? target : dirname(target);
  await assertGitRepo(cwd);
  const modeArgs = isDir ? ["--all"] : ["--files", target];
  const slugs = [...new Set(requested)];
  return mapPool(slugs, 4, (slug) => runOne(slug, cwd, modeArgs));
}
