import { spawn } from "node:child_process";
import { openAuditDb, resolveAuditDbPath } from "../db/audit.js";
import { getRuleFixes, type RuleAction } from "../db/fixes.js";
import { openDb, resolveDbPath, type Db } from "../db/open.js";
import { actionBehavior, DEFAULT_ACTION } from "./action-behavior.js";
import { RULES } from "./index.js";
import { dispatch } from "./runner.js";
import { GIT_STAGE_FLAG, type GitStage, type Stage } from "./stages.js";

export interface Dispatched {
  slug: string;
  /** The rule's effective default (env-null) action-type slug; falls back to `halt`. */
  action: string;
  /** The `script` fix to run before checking, when `action` is a fix variant; else null. */
  fix: RuleAction | null;
}

/**
 * The `script` fix a fix-bound rule must run. The panel only offers the fix
 * actions to rules that declare one, so a fix binding with no `script` action is
 * a corrupted config — surface it rather than silently skip the fix.
 */
function scriptFixAction(db: Db, slug: string): RuleAction {
  const fix = getRuleFixes(db, slug).find((a) => a.kind === "script");
  if (!fix) {
    throw new Error(
      `rule ${slug} is bound to a fix action but declares no script fix`,
    );
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
  )
    .sort((a, b) => {
      // Both rules passed the `enabled` filter, so both are rows in `rules` and
      // present in the order map — the assertions can't be undefined.
      const d = order.get(a.meta.slug)! - order.get(b.meta.slug)!;
      return d !== 0 ? d : a.meta.slug.localeCompare(b.meta.slug);
    })
    .map((r) => {
      const bound = defaultBinding.get(r.meta.slug) as
        { slug: string } | undefined;
      const action = bound?.slug ?? DEFAULT_ACTION;
      return {
        slug: r.meta.slug,
        action,
        fix: actionBehavior(action).runsFix
          ? scriptFixAction(db, r.meta.slug)
          : null,
      };
    });
}

/** git plumbing, capturing stdout; rejects on a non-zero exit. */
function runGit(args: string[], cwd: string): Promise<string> {
  return new Promise((resolveOut, reject) => {
    const child = spawn("git", args, {
      cwd,
      stdio: ["ignore", "pipe", "inherit"],
    });
    let out = "";
    child.stdout?.on("data", (d) => (out += d));
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0
        ? resolveOut(out)
        : reject(new Error(`git ${args[0]} exited ${code}`)),
    );
  });
}

function stagedFiles(cwd: string): Promise<string[]> {
  return runGit(
    ["diff", "--cached", "--name-only", "--diff-filter=ACMR"],
    cwd,
  ).then((out) =>
    out
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean),
  );
}

/**
 * Normalize a rule's deterministic fix into the spec `dispatch` (kind "staged")
 * spawns. A
 * `scriptPath` fix is the rule's own check runner in fix mode (`--fix` respects
 * the git selector); a `scriptBody` fix is a shell command (e.g. `prettier
 * --write`) handed the staged files — both stay scoped to what's being committed.
 * A shell fix with nothing staged is a no-op, returned as `null` (skip the spawn).
 */
function buildFixSpec(
  fix: RuleAction,
  selectorArgs: string[],
  staged: string[],
): { args: string[]; command?: string } | null {
  if (fix.scriptPath) return { args: selectorArgs };
  if (staged.length === 0) return null;
  const parts = (fix.scriptBody as string).trim().split(/\s+/);
  return { args: [...parts.slice(1), ...staged], command: parts[0] };
}

function parseStage(value: string | undefined): GitStage {
  if (value !== undefined && Object.hasOwn(GIT_STAGE_FLAG, value)) {
    return value as GitStage;
  }
  throw new Error(
    `dispatch: expected a git stage (${Object.keys(GIT_STAGE_FLAG).join(", ")}), got ${value ?? "(none)"}`,
  );
}

/** Stages that form a staged tree, where a fix can rewrite + re-stage before the check. */
function runsFixes(stage: GitStage): boolean {
  return GIT_STAGE_FLAG[stage] === "--staged";
}

/**
 * Run every enabled rule for a git stage through the single runner (runner.ts),
 * so each rule's fix+check is one logged run (run.start / run.end + a hook_run).
 * A rule's action binding decides what happens (action-behavior.ts): advisory
 * rules print but never fail; blocking rules fail the stage on the first non-zero
 * exit; fix rules run their deterministic fix first (staged stages only, then
 * re-stage the rewritten files) and warn/halt on whatever the fix couldn't resolve.
 */
export async function runDispatch(argv: string[]): Promise<void> {
  const stage = parseStage(argv[0]);
  const args = [GIT_STAGE_FLAG[stage], ...argv.slice(1)];
  const db = openDb(resolveDbPath());
  const selected = selectDispatch(db, stage);
  db.close();

  // Fixes only run on a staged tree — a pre-push fix can't reach pushed commits.
  const cwd = process.cwd();
  const fixing = runsFixes(stage) && selected.some((d) => d.fix);
  const staged = fixing ? await stagedFiles(cwd) : [];

  const auditDb = openAuditDb(resolveAuditDbPath());
  try {
    for (const { slug, action, fix } of selected) {
      const behavior = actionBehavior(action);
      const fixSpec =
        fix && runsFixes(stage) ? buildFixSpec(fix, args, staged) : null;
      const code = await dispatch(auditDb, {
        kind: "staged",
        run: {
          slug,
          stage,
          cwd,
          args,
          checks: behavior.checks,
          fixSpec,
          onFixed: staged.length
            ? async () => void (await runGit(["add", "--", ...staged], cwd))
            : undefined,
        },
      });
      if (code !== 0 && behavior.blocks) process.exit(code);
    }
  } finally {
    auditDb.close();
  }
}
