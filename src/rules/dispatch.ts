import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { openDb, resolveDbPath, type Db } from "../db/open.js";
import { RULES } from "./index.js";
import type { Stage } from "./types.js";

/** Package root: two levels up from this module (src/rules or dist/rules). */
const pkgRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Local git stages the dispatcher runs, and the mode flag each rule receives. */
const STAGE_FLAG = {
  "pre-commit": "--staged",
  "pre-push": "--push",
} as const;

type LocalStage = keyof typeof STAGE_FLAG;

export interface Dispatched {
  slug: string;
  advisory: boolean;
}

/**
 * The enabled rules bound to `stage`, in seed order. Stage is a package-static
 * property read from RULES; the DB supplies only `enabled` and the advisory flag.
 * A rule is advisory when it carries a default (all-environment) `warn` binding —
 * the DB-native replacement for the old `--warn` config entry.
 */
export function selectDispatch(db: Db, stage: Stage): Dispatched[] {
  const enabled = new Set(
    (
      db.prepare("SELECT slug FROM rules WHERE enabled = 1").all() as {
        slug: string;
      }[]
    ).map((r) => r.slug),
  );
  const warnBinding = db.prepare(
    `SELECT 1 FROM rule_actions ra
       JOIN rules r ON r.id = ra.rule_id
       JOIN action_types t ON t.id = ra.action_type_id
      WHERE r.slug = ? AND ra.environment_id IS NULL AND t.slug = 'warn'`,
  );
  return RULES.filter(
    (r) => r.meta.stage === stage && enabled.has(r.meta.slug),
  ).map((r) => ({
    slug: r.meta.slug,
    advisory: warnBinding.get(r.meta.slug) !== undefined,
  }));
}

function runRule(slug: string, args: string[]): Promise<number> {
  const script = resolve(pkgRoot, "hooks", "git", `${slug}.mjs`);
  return new Promise((resolveCode, reject) => {
    const child = spawn(process.execPath, [script, ...args], { stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (signal) reject(new Error(`${slug} killed by ${signal}`));
      else resolveCode(code ?? 0);
    });
  });
}

function parseStage(value: string | undefined): LocalStage {
  if (value === "pre-commit" || value === "pre-push") return value;
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
  const args = [STAGE_FLAG[stage], ...argv.slice(1)];
  const db = openDb(resolveDbPath());
  const selected = selectDispatch(db, stage);
  db.close();
  for (const { slug, advisory } of selected) {
    const code = await runRule(slug, args);
    if (code !== 0 && !advisory) process.exit(code);
  }
}
