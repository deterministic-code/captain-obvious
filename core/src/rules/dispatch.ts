import { spawn } from "node:child_process";
import { openAuditDb, recordHookRun, resolveAuditDbPath } from "../db/audit.js";
import { openDb, resolveDbPath, type Db } from "../db/open.js";
import { RULES } from "./index.js";
import { GIT_STAGE_FLAG, type GitStage, type Stage } from "./stages.js";

export interface Dispatched {
  slug: string;
  advisory: boolean;
}

/** A rule's absolute check-runner path, stamped by the loader (rules/<slug>/check.mjs). */
const CHECK_PATH = new Map(RULES.map((r) => [r.meta.slug, r.checkPath ?? null]));

/**
 * The enabled rules bound to `stage`, in seed order. Stage membership lives in
 * the DB (rule_stages), so toggling a rule's stages in the panel changes what
 * runs with no reinstall; the DB also supplies `enabled` and the advisory flag.
 * Intersected with RULES so only rules that ship a hook impl dispatch. A rule is
 * advisory when it carries a default (all-environment) `warn` binding — the
 * DB-native replacement for the old `--warn` config entry.
 */
export function selectDispatch(db: Db, stage: Stage): Dispatched[] {
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
  const warnBinding = db.prepare(
    `SELECT 1 FROM rule_actions ra
       JOIN rules r ON r.id = ra.rule_id
       JOIN action_types t ON t.id = ra.action_type_id
      WHERE r.slug = ? AND ra.environment_id IS NULL AND t.slug = 'warn'`,
  );
  return RULES.filter(
    (r) =>
      r.checkEntry !== null &&
      staged.has(r.meta.slug) &&
      enabled.has(r.meta.slug),
  ).map((r) => ({
    slug: r.meta.slug,
    advisory: warnBinding.get(r.meta.slug) !== undefined,
  }));
}

/** Absolute path to a rule's check runner, as stamped by the loader. */
export function checkScriptPath(slug: string): string {
  const entry = CHECK_PATH.get(slug);
  if (!entry) throw new Error(`rule has no check runner: ${slug}`);
  return entry;
}

function runRule(slug: string, args: string[]): Promise<number> {
  const script = checkScriptPath(slug);
  return new Promise((resolveCode, reject) => {
    const child = spawn(process.execPath, [script, ...args], { stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (signal) reject(new Error(`${slug} killed by ${signal}`));
      else resolveCode(code ?? 0);
    });
  });
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
 * hook `main()`s call process.exit, so they cannot share this one. Blocking rules
 * fail the stage on the first non-zero exit; advisory rules print but never fail.
 */
export async function runDispatch(argv: string[]): Promise<void> {
  const stage = parseStage(argv[0]);
  const args = [GIT_STAGE_FLAG[stage], ...argv.slice(1)];
  const db = openDb(resolveDbPath());
  const selected = selectDispatch(db, stage);
  db.close();
  const auditDb = openAuditDb(resolveAuditDbPath());
  try {
    for (const { slug, advisory } of selected) {
      const startedMs = Date.now();
      const code = await runRule(slug, args);
      recordHookRun(auditDb, {
        slug,
        stage,
        status: code === 0 ? "success" : "failure",
        startedMs,
        durationMs: Date.now() - startedMs,
      });
      if (code !== 0 && !advisory) process.exit(code);
    }
  } finally {
    auditDb.close();
  }
}
