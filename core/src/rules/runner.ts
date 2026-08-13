/**
 * THE single rule runner. Every rule execution — a git-hook check, a git/panel
 * fix, a Run-panel JSON scan, or an in-process Claude guard — flows through here,
 * so every run is bracketed by a `run.start` / `run.end` (or `run.error`) audit
 * entry and a `hook_runs` row. No other module may spawn a rule; a meta-test
 * (single-runner.test.ts) asserts this is the only spawn site. That makes "every
 * rule run is logged" a structural guarantee rather than a per-call-site promise.
 */
import { spawn } from "node:child_process";
import type { Readable } from "node:stream";
import { logEventTo, recordHookRun } from "../db/audit.js";
import type { Db } from "../db/open.js";
import { RULES } from "./index.js";
import type { Violation } from "./types.js";

/** A rule's absolute check-runner path (rules/<slug>/check.mjs), stamped by the loader. */
const CHECK_PATH = new Map(
  RULES.map((r) => [r.meta.slug, r.checkPath ?? null]),
);

/** Absolute path to a rule's check runner, as stamped by the loader. */
export function checkScriptPath(slug: string): string {
  const entry = CHECK_PATH.get(slug);
  if (!entry) throw new Error(`rule has no check runner: ${slug}`);
  return entry;
}

/** The extra fd a check writes its result sentinel to (see rules/_kit emitFound). */
const RESULT_FD = 3;

/**
 * How a run is executed and its result parsed:
 *  - `check` — spawn check.mjs, inherit stdio, read the `found` count on fd 3 (git dispatch).
 *  - `json`  — spawn check.mjs with CO_JSON=1, parse a `{"violations":[…]}` line off stdout (Run panel).
 *  - `fix`   — spawn check.mjs `--fix` (or `command`, an arbitrary formatter), collect output, count files fixed.
 */
export type RunSpec = {
  slug: string;
  stage: string;
  cwd: string;
  /** Selector/mode args passed to the child (e.g. `--staged`, `--all`, `--files <p>`). */
  args: string[];
} & ({ mode: "check" } | { mode: "json" } | { mode: "fix"; command?: string });

export interface RunOutcome {
  code: number;
  /** Violations the check reported on fd 3 (check mode); null otherwise. */
  found: number | null;
  /** Files a fix reformatted (fix mode, on success); null otherwise. */
  fixed: number | null;
  /** The paths a fix reformatted (fix mode, on success); null otherwise. `fixed` is its length. */
  fixedFiles: string[] | null;
  /** Structured violations parsed off stdout (json mode); null when the hook emitted none. */
  violations: Violation[] | null;
  /** Merged stdout+stderr, trimmed (json/fix modes); empty for the stdio-inherit check mode. */
  output: string;
  /** Stderr alone, trimmed — the human error text json mode reports when it emits no JSON. */
  stderr: string;
}

interface SpawnPlan {
  cmd: string;
  argv: string[];
  env: NodeJS.ProcessEnv;
  stdio: Parameters<typeof spawn>[2]["stdio"];
}

function planSpawn(spec: RunSpec): SpawnPlan {
  const env = { ...process.env };
  switch (spec.mode) {
    case "check":
      return {
        cmd: process.execPath,
        argv: [checkScriptPath(spec.slug), ...spec.args],
        env: { ...env, CO_RESULT_FD: String(RESULT_FD) },
        stdio: ["inherit", "inherit", "inherit", "pipe"],
      };
    case "json":
      return {
        cmd: process.execPath,
        argv: [checkScriptPath(spec.slug), ...spec.args],
        env: { ...env, CO_JSON: "1" },
        stdio: ["ignore", "pipe", "pipe"],
      };
    case "fix":
      return {
        cmd: spec.command ?? process.execPath,
        argv: spec.command
          ? spec.args
          : [checkScriptPath(spec.slug), "--fix", ...spec.args],
        env,
        stdio: ["ignore", "pipe", "pipe"],
      };
  }
}

/** Parse the check's result sentinel — the last JSON line on fd 3 — into a found count. */
function parseFound(raw: string): number | null {
  const line = raw
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .pop();
  if (!line) return null;
  const parsed = JSON.parse(line) as { found?: unknown };
  return typeof parsed.found === "number" ? parsed.found : null;
}

/** Parse a `{"violations":[…]}` line; null when it isn't that shape (surfaced as an error upstream). */
function parseViolations(out: string): Violation[] | null {
  const line = out.trim().split("\n").filter(Boolean).pop();
  if (!line) return null;
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return null;
  }
  const violations = (value as { violations?: unknown } | null)?.violations;
  return Array.isArray(violations) ? (violations as Violation[]) : null;
}

/**
 * The files a formatter reformatted (prettier-style output; lines without
 * "(unchanged)"), each stripped of a trailing ` <n>ms` timing suffix so a raw
 * formatter's `path 12ms` line yields a clean path.
 */
export function modifiedFiles(output: string): string[] {
  const files: string[] = [];
  for (const line of output.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || line.startsWith("lint-") || trimmed.startsWith("Re-stage"))
      continue;
    if (trimmed.includes("(unchanged)")) continue;
    files.push(trimmed.replace(/\s+\d+ms$/, ""));
  }
  return files;
}

/** The one child spawn. Rejects on spawn error or kill signal (→ run.error); resolves on any exit code. */
export function spawnRule(spec: RunSpec): Promise<RunOutcome> {
  const { cmd, argv, env, stdio } = planSpawn(spec);
  return new Promise((resolveOutcome, reject) => {
    const child = spawn(cmd, argv, { cwd: spec.cwd, env, stdio });
    let fd3 = "";
    let stdout = "";
    let stderr = "";
    (child.stdio?.[RESULT_FD] as Readable | undefined)?.on("data", (d) => {
      fd3 += d;
    });
    child.stdout?.on("data", (d) => (stdout += d));
    child.stderr?.on("data", (d) => (stderr += d));
    child.on("error", reject);
    // `check` inherits stdout and only needs fd 3 + the exit code, so it resolves
    // on `exit`; the capture modes need stdout fully flushed, which `close` guarantees.
    const doneEvent = spec.mode === "check" ? "exit" : "close";
    child.on(doneEvent, (code: number | null, signal: string | null) => {
      if (signal) return reject(new Error(`${spec.slug} killed by ${signal}`));
      const c = code ?? 0;
      const merged = `${stdout}${stderr}`.trim();
      const fixedFiles =
        spec.mode === "fix" && c === 0 ? modifiedFiles(merged) : null;
      resolveOutcome({
        code: c,
        found: spec.mode === "check" ? parseFound(fd3) : null,
        fixed: fixedFiles?.length ?? null,
        fixedFiles,
        // Violations parse from stdout alone — a rule's human/error text on stderr
        // must not be mistaken for the structured JSON line.
        violations:
          spec.mode === "json" && c === 0 ? parseViolations(stdout) : null,
        output: merged,
        stderr: stderr.trim(),
      });
    });
  });
}

/** The audit-log detail for a completed run — the per-run outcome that confirms the rule ran. */
export function formatRunEnd(
  stage: string,
  slug: string,
  o: { found?: number | null; fixed?: number | null; issues?: number | null },
  code: number,
): string {
  const head = `${stage}/${slug}`;
  if (o.found != null) return `${head} — ${o.found} issue(s) found`;
  if (o.fixed != null) return `${head} — ${o.fixed} file(s) fixed`;
  if (o.issues != null) return `${head} — ${o.issues} issue(s)`;
  return `${head} — ${code === 0 ? "success" : "failure"}`;
}

/** One run's audit facts, as the bracket needs them once the work completes. */
export interface RunRecord {
  code: number;
  found: number | null;
  fixed: number | null;
  /** The run.end detail line. */
  detail: string;
}

/**
 * Bracket any rule work between a run.start and a run.end / run.error, recording
 * the hook_run. The shared logging chokepoint behind every public entry below —
 * spawned checks/fixes and in-process guards alike pass through here, so no rule
 * runs without both a start and an end/error row.
 */
export async function runLogged<T>(
  auditDb: Db,
  slug: string,
  stage: string,
  label: string,
  work: () => Promise<{ record: RunRecord; value: T }>,
): Promise<T> {
  logEventTo(auditDb, "run.start", `${stage}/${slug} (${label})`);
  const startedMs = Date.now();
  try {
    const { record, value } = await work();
    recordHookRun(auditDb, {
      slug,
      stage,
      status: record.code === 0 ? "success" : "failure",
      startedMs,
      durationMs: Date.now() - startedMs,
      found: record.found,
      fixed: record.fixed,
    });
    logEventTo(auditDb, "run.end", record.detail);
    return value;
  } catch (err) {
    recordHookRun(auditDb, {
      slug,
      stage,
      status: "failure",
      startedMs,
      durationMs: Date.now() - startedMs,
    });
    logEventTo(
      auditDb,
      "run.error",
      `${stage}/${slug} — ${(err as Error).message}`,
    );
    throw err;
  }
}

/**
 * Run one rule (spawned check / json / fix) and log it. The sole executor of a
 * spawned rule; callers build a RunSpec and never spawn themselves.
 */
export function dispatchRule(auditDb: Db, spec: RunSpec): Promise<RunOutcome> {
  return runLogged(auditDb, spec.slug, spec.stage, spec.mode, async () => {
    const outcome = await spawnRule(spec);
    return {
      record: {
        code: outcome.code,
        found: outcome.found,
        fixed: outcome.fixed,
        detail: formatRunEnd(
          spec.stage,
          spec.slug,
          {
            found: outcome.found,
            fixed: outcome.fixed,
            issues: outcome.violations?.length ?? null,
          },
          outcome.code,
        ),
      },
      value: outcome,
    };
  });
}

/** A Claude guard's verdict for one PreToolUse/Stop event. */
export interface GuardVerdict {
  deny: boolean;
  reason?: string;
}

/**
 * Run one in-process guard rule (no child process) and log it exactly like a
 * spawned run: `run.start`, a `hook_run` (failure when it denies, success when it
 * allows), and `run.end`. `evaluate` is the rule's pure decision function. Guards
 * are the tool/stop-stage rules whose "check" is a fast in-process policy test
 * rather than a spawned check.mjs.
 */
export function dispatchGuard(
  auditDb: Db,
  slug: string,
  stage: string,
  evaluate: () => GuardVerdict | Promise<GuardVerdict>,
): Promise<GuardVerdict> {
  return runLogged(auditDb, slug, stage, "guard", async () => {
    const verdict = await evaluate();
    return {
      record: {
        code: verdict.deny ? 1 : 0,
        found: null,
        fixed: null,
        detail: `${stage}/${slug} — ${verdict.deny ? "denied" : "allowed"}`,
      },
      value: verdict,
    };
  });
}
