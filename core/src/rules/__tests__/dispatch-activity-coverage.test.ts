import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:child_process", () => ({ spawn: vi.fn() }));

import { spawn } from "node:child_process";
import { listHookRuns, openAuditDb } from "../../db/audit.js";
import { openDb } from "../../db/open.js";
import { seedRules } from "../../db/seed.js";
import { runDispatch } from "../dispatch.js";
import { RULES } from "../index.js";
import type { Stage } from "../types.js";

const spawnMock = vi.mocked(spawn);

const LOCAL_STAGES: Stage[] = ["pre-commit", "pre-push"];

/**
 * Every (rule, local git stage) pair the dispatcher can run — the exact set that
 * should each produce an Activity row. Built from the registry the same way the
 * dispatch-audit test derives its coverage, so it grows automatically with RULES.
 */
const CASES = RULES.flatMap((r) =>
  r.meta.stages
    .filter((s): s is Stage => LOCAL_STAGES.includes(s))
    .map((stage) => ({ slug: r.meta.slug, stage })),
);

/** A fake child that emits its outcome on the next microtask, like a real spawn. */
function fakeChild(emit: (c: EventEmitter) => void): EventEmitter {
  const c = new EventEmitter();
  queueMicrotask(() => emit(c));
  return c;
}

/** The hook runs the dispatcher recorded into the temp audit DB, newest-first. */
function recordedRuns(): { slug: string; stage: string; status: string }[] {
  const db = openAuditDb(process.env.CAPTAIN_OBVIOUS_AUDIT_DB as string);
  try {
    return listHookRuns(db).map(({ slug, stage, status }) => ({ slug, stage, status }));
  } finally {
    db.close();
  }
}

let dbPath: string;
let tmpDir: string;
const savedEnv = process.env.CAPTAIN_OBVIOUS_DB;
const savedAuditEnv = process.env.CAPTAIN_OBVIOUS_AUDIT_DB;
let exitSpy: ReturnType<typeof vi.spyOn>;

/** Enable exactly the given slugs, disabling every other rule, so selectDispatch is deterministic. */
function enableOnly(...slugs: string[]): void {
  const db = openDb(dbPath);
  const placeholders = slugs.map(() => "?").join(",");
  db.prepare(
    `UPDATE rules SET enabled = CASE WHEN slug IN (${placeholders}) THEN 1 ELSE 0 END`,
  ).run(...slugs);
  db.close();
}

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "co-activity-"));
  dbPath = join(tmpDir, "registry.db");
  const db = openDb(dbPath);
  seedRules(db, RULES);
  db.close();
  process.env.CAPTAIN_OBVIOUS_DB = dbPath;
  process.env.CAPTAIN_OBVIOUS_AUDIT_DB = join(tmpDir, "audit.db");

  // Default: every spawn is a clean success; individual tests override for failures.
  spawnMock.mockImplementation(
    () => fakeChild((c) => c.emit("exit", 0, null)) as never,
  );
  exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
    throw new Error("process.exit:" + code);
  }) as never);
});

afterEach(() => {
  if (savedEnv === undefined) delete process.env.CAPTAIN_OBVIOUS_DB;
  else process.env.CAPTAIN_OBVIOUS_DB = savedEnv;
  if (savedAuditEnv === undefined) delete process.env.CAPTAIN_OBVIOUS_AUDIT_DB;
  else process.env.CAPTAIN_OBVIOUS_AUDIT_DB = savedAuditEnv;
  rmSync(tmpDir, { recursive: true, force: true });
  vi.restoreAllMocks();
  spawnMock.mockReset();
});

describe("dispatch activity coverage — every git-stage rule logs a hook_run", () => {
  it("covers more than a couple of rule/stage pairs (guards against silent under-wiring)", () => {
    expect(CASES.length).toBeGreaterThan(20);
  });

  it.each(CASES)(
    "$slug logs a success hook_run at $stage when its hook passes",
    async ({ slug, stage }) => {
      enableOnly(slug);
      await expect(runDispatch([stage])).resolves.toBeUndefined();
      expect(exitSpy).not.toHaveBeenCalled();
      expect(recordedRuns()).toEqual([{ slug, stage, status: "success" }]);
    },
  );

  it.each(CASES)(
    "$slug logs a failure hook_run at $stage even when its hook errors",
    async ({ slug, stage }) => {
      enableOnly(slug);
      spawnMock.mockImplementationOnce(
        () => fakeChild((c) => c.emit("exit", 1, null)) as never,
      );
      // Fail-fast: the blocking failure is recorded, then the stage aborts via process.exit.
      await expect(runDispatch([stage])).rejects.toThrow("process.exit:1");
      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(recordedRuns()).toEqual([{ slug, stage, status: "failure" }]);
    },
  );

  it("stops at the first blocking failure — later rules never run or log (the sparse-feed root cause)", async () => {
    const pair = ["lint-comments", "lint-naming"];
    const first = RULES.map((r) => r.meta.slug).find((s) => pair.includes(s)) as string;
    enableOnly(...pair);
    spawnMock.mockImplementationOnce(
      () => fakeChild((c) => c.emit("exit", 1, null)) as never,
    );

    await expect(runDispatch(["pre-commit"])).rejects.toThrow("process.exit:1");
    // Only the first rule was spawned; the second was short-circuited and left no Activity row.
    expect(spawnMock).toHaveBeenCalledTimes(1);
    expect(recordedRuns()).toEqual([
      { slug: first, stage: "pre-commit", status: "failure" },
    ]);
  });
});
