import { mkdtempSync, rmSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// @ts-expect-error - plain ESM test helper shared with the .mjs hook suites
import {
  cleanupTmp,
  gitIn,
  makeTempGitRepo,
} from "../../../hooks/git/__tests__/test-helpers.mjs";
import { listHookRuns, openAuditDb } from "../../db/audit.js";
import { openDb } from "../../db/open.js";
import { seedRules } from "../../db/seed.js";
import { runDispatch } from "../dispatch.js";
import { RULES } from "../index.js";

// Pure file linters that no-op cleanly on an empty changeset (no external tools,
// no network) — enough to prove the dispatcher spawns real hooks and logs each.
const SUBSET = [
  "lint-comments",
  "lint-naming",
  "lint-max-line-length",
  "lint-max-params",
];

let repo: string;
let dbDir: string;
const savedCwd = process.cwd();
const savedDb = process.env.CAPTAIN_OBVIOUS_DB;
const savedAudit = process.env.CAPTAIN_OBVIOUS_AUDIT_DB;
let exitSpy: ReturnType<typeof vi.spyOn>;

beforeEach(async () => {
  repo = await makeTempGitRepo("co-dispatch-int-");
  dbDir = mkdtempSync(join(tmpdir(), "co-dispatch-db-"));
  const dbPath = join(dbDir, "registry.db");
  const db = openDb(dbPath);
  seedRules(db, RULES);
  const placeholders = SUBSET.map(() => "?").join(",");
  db.prepare(
    `UPDATE rules SET enabled = CASE WHEN slug IN (${placeholders}) THEN 1 ELSE 0 END`,
  ).run(...SUBSET);
  db.close();
  process.env.CAPTAIN_OBVIOUS_DB = dbPath;
  process.env.CAPTAIN_OBVIOUS_AUDIT_DB = join(dbDir, "audit.db");
  // The dispatcher spawns children with the inherited cwd; point it at the temp repo.
  process.chdir(repo);
  exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
    throw new Error("process.exit:" + code);
  }) as never);
});

afterEach(async () => {
  process.chdir(savedCwd);
  if (savedDb === undefined) delete process.env.CAPTAIN_OBVIOUS_DB;
  else process.env.CAPTAIN_OBVIOUS_DB = savedDb;
  if (savedAudit === undefined) delete process.env.CAPTAIN_OBVIOUS_AUDIT_DB;
  else process.env.CAPTAIN_OBVIOUS_AUDIT_DB = savedAudit;
  vi.restoreAllMocks();
  rmSync(dbDir, { recursive: true, force: true });
  await cleanupTmp(repo);
});

describe("dispatch integration — real hooks run and log activity", () => {
  it("records a success hook_run for every enabled pre-commit rule", async () => {
    await expect(runDispatch(["pre-commit"])).resolves.toBeUndefined();
    expect(exitSpy).not.toHaveBeenCalled();

    const audit = openAuditDb(process.env.CAPTAIN_OBVIOUS_AUDIT_DB as string);
    try {
      const runs = listHookRuns(audit);
      const bySlug = new Map(runs.map((r) => [r.slug, r]));
      for (const slug of SUBSET) {
        expect(bySlug.get(slug)).toMatchObject({
          stage: "pre-commit",
          status: "success",
        });
      }
      // Exactly the enabled subset ran — no rule silently skipped or doubled.
      expect(runs).toHaveLength(SUBSET.length);
    } finally {
      audit.close();
    }
  }, 30_000);

  it("records a failure hook_run when a real hook finds a violation", async () => {
    const db = openDb(process.env.CAPTAIN_OBVIOUS_DB as string);
    db.prepare(
      "UPDATE rules SET enabled = CASE WHEN slug = 'lint-naming' THEN 1 ELSE 0 END",
    ).run();
    db.close();
    // A staged snake_case declaration makes the real lint-naming hook exit non-zero.
    await writeFile(join(repo, "bad.ts"), "const new_version = 1;\n");
    await gitIn(repo, ["add", "bad.ts"]);

    await expect(runDispatch(["pre-commit"])).rejects.toThrow("process.exit:1");
    expect(exitSpy).toHaveBeenCalledWith(1);

    const audit = openAuditDb(process.env.CAPTAIN_OBVIOUS_AUDIT_DB as string);
    try {
      // The failure is logged as an Activity row before the stage aborts.
      expect(listHookRuns(audit)).toEqual([
        expect.objectContaining({
          slug: "lint-naming",
          stage: "pre-commit",
          status: "failure",
        }),
      ]);
    } finally {
      audit.close();
    }
  }, 30_000);
});
