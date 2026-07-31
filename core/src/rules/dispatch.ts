import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { openAuditDb, recordHookRun, resolveAuditDbPath } from "../db/audit.js";
import { getRuleFixes, type RuleAction } from "../db/fixes.js";
import { openDb, resolveDbPath, type Db } from "../db/open.js";
import { actionBehavior, DEFAULT_ACTION } from "./action-behavior.js";
import { RULES } from "./index.js";
import { GIT_STAGE_FLAG, type GitStage, type Stage } from "./stages.js";

export interface Dispatched {
  slug: string;
  /** The rule's effective default (env-null) action-type slug; falls back to `halt`. */
  action: string;
  /** The `script` fix to run before checking, when `action` is a fix variant; else null. */
  fix: RuleAction | null;
}

/** A rule's absolute check-runner path, stamped by the loader (rules/<slug>/check.mjs). */
const CHECK_PATH = new Map(RULES.map((r) => [r.meta.slug, r.checkPath ?? null]));

/**
 * The `script` fix a fix-bound rule must run. The panel only offers the fix
 * actions to rules that declare one, so a fix binding with no `script` action is
 * a corrupted config — surface it rather than silently skip the fix.
 */
function scriptFixAction(db: Db, slug: string): RuleAction {
  const fix = getRuleFixes(db, slug).find((a) => a.kind === "script");
  if (!fix) {
    throw new Error(`rule ${slug} is bound to a fix action but declares no script fix`);
  }
  return fix;
}

/**
 * The enabled rules bound to `stage`, in the order set by rules.sort_index (ties
 * break by slug). Stage membership lives in the DB (rule_stages), so toggling a
 * rule's stages in the panel changes what runs with no reinstall; the DB also
 * supplies `enabled`, the sort order, and each rule's default action-type binding.
 * Intersected with RULES so only rules that ship a hook impl dispatch. The binding
 * drives runner behavior (see action-behavior.ts): a `warn` rule is advisory, a
 * `fix*` rule runs its deterministic fix first.
 */
export function selectDispatch(db: Db, stage: Stage): Dispatched[] {
  const order = new Map(
    (
      db.prepare("SELECT slug, sort_index AS sortIndex FROM rules").all() as {
        slug: string;
        sortIndex: number;
      }[]
    ).map((r) => [r.slug, r.sortIndex] as const),
  );
  const enabled = new Set(
    (
      db.prepare("SELECT slug FROM rules WHERE enabled = 1").all() as {
        slug: string;
      }[]
    ).map((r) => r.slug),
  );
  const staged = new Set(
    (
      db
        .prepare(
          `SELECT r.slug AS slug FROM rule_stages rs
             JOIN rules r ON r.id = rs.rule_id
            WHERE rs.stage = ?`,
        )
        .all(stage) as { slug: string }[]
    ).map((r) => r.slug),
  );
  const defaultBinding = db.prepare(
    `SELECT t.slug AS slug FROM rule_actions ra
       JOIN rules r ON r.id = ra.rule_id
       JOIN action_types t ON t.id = ra.action_type_id
      WHERE r.slug = ? AND ra.environment_id IS NULL`,
  );
  return RULES.filter(
    (r) =>
      r.checkEntry !== null &&
      staged.has(r.meta.slug) &&
      enabled.has(r.meta.slug),
  ).sort((a, b) => {
    // Both rules passed the `enabled` filter, so both are rows in `rules` and
    // present in the order map — the assertions can't be undefined.
    const d = order.get(a.meta.slug)! - order.get(b.meta.slug)!;
    return d !== 0 ? d : a.meta.slug.localeCompare(b.meta.slug);
  }).map((r) => {
    const bound = defaultBinding.get(r.meta.slug) as { slug: string } | undefined;
    const action = bound?.slug ?? DEFAULT_ACTION;
    return {
      slug: r.meta.slug,
      action,
      fix: actionBehavior(action).runsFix ? scriptFixAction(db, r.meta.slug) : null,
    };
  });
}

/** Absolute path to a rule's check runner, as stamped by the loader. */
export function checkScriptPath(slug: string): string {
  const entry = CHECK_PATH.get(slug);
  if (!entry) throw new Error(`rule has no check runner: ${slug}`);
  return entry;
}

/** Spawn a child with inherited stdio, resolving its exit code (killed → reject). */
function spawnProcess(
  command: string,
  args: string[],
  label: string,
  cwd?: string,
): Promise<number> {
  return new Promise((resolveCode, reject) => {
    const child = spawn(command, args, cwd ? { stdio: "inherit", cwd } : { stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (signal) reject(new Error(`${label} killed by ${signal}`));
      else resolveCode(code ?? 0);
    });
  });
}

function runRule(slug: string, args: string[]): Promise<number> {
  return spawnProcess(process.execPath, [checkScriptPath(slug), ...args], slug);
}

/** git plumbing, capturing stdout; rejects on a non-zero exit. */
function runGit(args: string[], cwd: string): Promise<string> {
  return new Promise((resolveOut, reject) => {
    const child = spawn("git", args, { cwd, stdio: ["ignore", "pipe", "inherit"] });
    let out = "";
    child.stdout?.on("data", (d) => (out += d));
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0 ? resolveOut(out) : reject(new Error(`git ${args[0]} exited ${code}`)),
    );
  });
}

function stagedFiles(cwd: string): Promise<string[]> {
  return runGit(["diff", "--cached", "--name-only", "--diff-filter=ACMR"], cwd).then((out) =>
    out.split("\n").map((l) => l.trim()).filter(Boolean),
  );
}

/**
 * Run a rule's deterministic fix over the staged set. A `scriptPath` fix is the
 * rule's own check runner in fix mode (`--fix` respects the git selector); a
 * `scriptBody` fix is a shell command (e.g. `prettier --write`) handed the staged
 * files, so both stay scoped to what's being committed.
 */
function runRuleFix(
  fix: RuleAction,
  cwd: string,
  selectorArgs: string[],
  staged: string[],
): Promise<number> {
  if (fix.scriptPath) {
    return spawnProcess(
      process.execPath,
      [resolve(cwd, fix.scriptPath), "--fix", ...selectorArgs],
      "fix",
      cwd,
    );
  }
  if (staged.length === 0) return Promise.resolve(0);
  const parts = (fix.scriptBody as string).trim().split(/\s+/);
  return spawnProcess(parts[0], [...parts.slice(1), ...staged], "fix", cwd);
}

function parseStage(value: string | undefined): GitStage {
  if (value !== undefined && Object.hasOwn(GIT_STAGE_FLAG, value)) {
    return value as GitStage;
  }
  throw new Error(
    `dispatch: expected stage 'pre-commit' or 'pre-push', got ${value ?? "(none)"}`,
  );
}

/**
 * Run every enabled rule for a git stage, each as an isolated child process — the
 * hook `main()`s call process.exit, so they cannot share this one. A rule's
 * action binding decides what happens (action-behavior.ts): advisory rules print
 * but never fail; blocking rules fail the stage on the first non-zero exit; fix
 * rules run their deterministic fix first (pre-commit only, then re-stage the
 * rewritten files) and warn/halt on whatever the fix couldn't resolve.
 */
export async function runDispatch(argv: string[]): Promise<void> {
  const stage = parseStage(argv[0]);
  const args = [GIT_STAGE_FLAG[stage], ...argv.slice(1)];
  const db = openDb(resolveDbPath());
  const selected = selectDispatch(db, stage);
  db.close();

  // Fixes only run pre-commit — a pre-push fix can't reach the pushed commits.
  const cwd = process.cwd();
  const fixing = stage === "pre-commit" && selected.some((d) => d.fix);
  const staged = fixing ? await stagedFiles(cwd) : [];

  const auditDb = openAuditDb(resolveAuditDbPath());
  try {
    for (const { slug, action, fix } of selected) {
      const behavior = actionBehavior(action);
      const startedMs = Date.now();
      if (fix && stage === "pre-commit") {
        await runRuleFix(fix, cwd, args, staged);
        if (staged.length) await runGit(["add", "--", ...staged], cwd);
      }
      const code = behavior.checks ? await runRule(slug, args) : 0;
      recordHookRun(auditDb, {
        slug,
        stage,
        status: code === 0 ? "success" : "failure",
        startedMs,
        durationMs: Date.now() - startedMs,
      });
      if (code !== 0 && behavior.blocks) process.exit(code);
    }
  } finally {
    auditDb.close();
  }
}
