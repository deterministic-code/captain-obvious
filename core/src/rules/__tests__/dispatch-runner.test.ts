import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:child_process", () => ({ spawn: vi.fn() }));

import { spawn } from "node:child_process";
import { listHookRuns, openAuditDb } from "../../db/audit.js";
import { openDb } from "../../db/open.js";
import { seedRules } from "../../db/seed.js";
import { runDispatch } from "../dispatch.js";
import { RULES } from "../index.js";

const spawnMock = vi.mocked(spawn);

const pkgRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "..",
);

/** The hook runs the dispatcher recorded into the temp audit DB, newest-first. */
function recordedRuns(): { slug: string; stage: string; status: string }[] {
  const db = openAuditDb(process.env.CAPTAIN_OBVIOUS_AUDIT_DB as string);
  try {
    return listHookRuns(db).map(({ slug, stage, status }) => ({
      slug,
      stage,
      status,
    }));
  } finally {
    db.close();
  }
}

/** The found-count of each recorded hook run, newest-first. */
function recordedFound(): (number | null)[] {
  const db = openAuditDb(process.env.CAPTAIN_OBVIOUS_AUDIT_DB as string);
  try {
    return listHookRuns(db).map((r) => r.found);
  } finally {
    db.close();
  }
}

type FakeChild = EventEmitter & { stdio: (EventEmitter | null)[] };

/**
 * A fake child that emits its outcome on the next microtask, like a real spawn.
 * Carries a result pipe at fd 3 (the check's out-of-band count channel); a test
 * emits `data` on it to simulate a check reporting its violation count.
 */
function fakeChild(emit: (c: FakeChild) => void): FakeChild {
  const c = Object.assign(new EventEmitter(), {
    stdio: [null, null, null, new EventEmitter()] as (EventEmitter | null)[],
  });
  queueMicrotask(() => emit(c));
  return c;
}

let dbPath: string;
let tmpDir: string;
const savedEnv = process.env.CAPTAIN_OBVIOUS_DB;
const savedAuditEnv = process.env.CAPTAIN_OBVIOUS_AUDIT_DB;

/** Disable every pre-commit rule except one, so selectDispatch returns exactly one. */
function isolatePreCommit(slug: string, { advisory = false } = {}): void {
  const db = openDb(dbPath);
  db.prepare("UPDATE rules SET enabled = 0 WHERE slug != ?").run(slug);
  if (advisory) {
    const ruleId = (
      db.prepare("SELECT id FROM rules WHERE slug = ?").get(slug) as {
        id: number;
      }
    ).id;
    const warnId = (
      db.prepare("SELECT id FROM action_types WHERE slug = 'warn'").get() as {
        id: number;
      }
    ).id;
    db.prepare(
      "DELETE FROM rule_actions WHERE rule_id = ? AND environment_id IS NULL",
    ).run(ruleId);
    db.prepare(
      "INSERT INTO rule_actions (rule_id, environment_id, action_type_id) VALUES (?, NULL, ?)",
    ).run(ruleId, warnId);
  }
  db.close();
}

let exitSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "co-dispatch-"));
  dbPath = join(tmpDir, "registry.db");
  const db = openDb(dbPath);
  seedRules(db, RULES);
  db.close();
  process.env.CAPTAIN_OBVIOUS_DB = dbPath;
  process.env.CAPTAIN_OBVIOUS_AUDIT_DB = join(tmpDir, "audit.db");

  // Default: every spawn is a clean success.
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

describe("runDispatch", () => {
  it("runs a single blocking rule, resolving cleanly and never exiting", async () => {
    isolatePreCommit("lint-naming");
    bindDefault("lint-naming", "halt");
    await expect(runDispatch(["pre-commit"])).resolves.toBeUndefined();
    expect(exitSpy).not.toHaveBeenCalled();
    expect(spawnMock).toHaveBeenCalledTimes(1);

    const script = resolve(pkgRoot, "rules", "lint-naming", "check.mjs");
    expect(spawnMock).toHaveBeenCalledWith(
      process.execPath,
      [script, "--staged"],
      expect.objectContaining({
        stdio: ["inherit", "inherit", "inherit", "pipe"],
        env: expect.objectContaining({ CO_RESULT_FD: "3" }),
      }),
    );
    // The clean run is recorded as a hook_run for the Activity view.
    expect(recordedRuns()).toEqual([
      { slug: "lint-naming", stage: "pre-commit", status: "success" },
    ]);
  });

  it("passes --push for the pre-push stage", async () => {
    // Keep whichever pre-push rule seeds first enabled; the default spawn passes.
    await expect(runDispatch(["pre-push"])).resolves.toBeUndefined();
    const args = spawnMock.mock.calls[0][1] as string[];
    expect(args[1]).toBe("--push");
  });

  it("exits with the child's code on a blocking failure and stops", async () => {
    isolatePreCommit("lint-naming");
    bindDefault("lint-naming", "halt");
    spawnMock.mockImplementationOnce(
      () => fakeChild((c) => c.emit("exit", 2, null)) as never,
    );
    await expect(runDispatch(["pre-commit"])).rejects.toThrow("process.exit:2");
    expect(exitSpy).toHaveBeenCalledWith(2);
    expect(spawnMock).toHaveBeenCalledTimes(1);
    // The failing run is recorded before the stage aborts.
    expect(recordedRuns()).toEqual([
      { slug: "lint-naming", stage: "pre-commit", status: "failure" },
    ]);
  });

  it("does not exit when an advisory rule fails", async () => {
    isolatePreCommit("lint-naming", { advisory: true });
    spawnMock.mockImplementationOnce(
      () => fakeChild((c) => c.emit("exit", 1, null)) as never,
    );
    await expect(runDispatch(["pre-commit"])).resolves.toBeUndefined();
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it("treats a null exit code as success", async () => {
    isolatePreCommit("lint-naming");
    spawnMock.mockImplementationOnce(
      () => fakeChild((c) => c.emit("exit", null, null)) as never,
    );
    await expect(runDispatch(["pre-commit"])).resolves.toBeUndefined();
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it("rejects when the child is killed by a signal, still logging a failure", async () => {
    isolatePreCommit("lint-naming");
    spawnMock.mockImplementationOnce(
      () => fakeChild((c) => c.emit("exit", null, "SIGKILL")) as never,
    );
    await expect(runDispatch(["pre-commit"])).rejects.toThrow(
      /killed by SIGKILL/,
    );
    expect(recordedRuns()).toEqual([
      { slug: "lint-naming", stage: "pre-commit", status: "failure" },
    ]);
  });

  it("rejects when the child emits an error, still logging a failure", async () => {
    isolatePreCommit("lint-naming");
    spawnMock.mockImplementationOnce(
      () => fakeChild((c) => c.emit("error", new Error("boom"))) as never,
    );
    await expect(runDispatch(["pre-commit"])).rejects.toThrow(/boom/);
    expect(recordedRuns()).toEqual([
      { slug: "lint-naming", stage: "pre-commit", status: "failure" },
    ]);
  });

  it("records the violation count a check reports on fd 3", async () => {
    isolatePreCommit("lint-naming");
    bindDefault("lint-naming", "halt");
    spawnMock.mockImplementationOnce(
      () =>
        fakeChild((c) => {
          c.stdio[3]!.emit("data", Buffer.from('{"found":4}\n'));
          c.emit("exit", 1, null);
        }) as never,
    );
    await expect(runDispatch(["pre-commit"])).rejects.toThrow("process.exit:1");
    expect(recordedFound()).toEqual([4]);
  });

  it("records a null count when the check reports nothing on fd 3", async () => {
    isolatePreCommit("lint-naming");
    bindDefault("lint-naming", "halt");
    // Default spawn exits 0 without writing to the result pipe.
    await expect(runDispatch(["pre-commit"])).resolves.toBeUndefined();
    expect(recordedFound()).toEqual([null]);
  });

  it("records a null count when the result line carries no numeric found", async () => {
    isolatePreCommit("lint-naming");
    bindDefault("lint-naming", "halt");
    spawnMock.mockImplementationOnce(
      () =>
        fakeChild((c) => {
          c.stdio[3]!.emit("data", Buffer.from("{}\n"));
          c.emit("exit", 0, null);
        }) as never,
    );
    await expect(runDispatch(["pre-commit"])).resolves.toBeUndefined();
    expect(recordedFound()).toEqual([null]);
  });

  it("rejects on an invalid stage before spawning", async () => {
    await expect(runDispatch(["bogus"])).rejects.toThrow(
      /expected a git stage \(pre-commit, /,
    );
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("rejects with (none) when no stage is given", async () => {
    await expect(runDispatch([])).rejects.toThrow(/\(none\)/);
    expect(spawnMock).not.toHaveBeenCalled();
  });
});

// A child whose stdout emits `data` before it exits, like `git diff` piping names.
function childWithStdout(data: string, code: number): EventEmitter {
  const c = new EventEmitter() as EventEmitter & { stdout: EventEmitter };
  c.stdout = new EventEmitter();
  queueMicrotask(() => {
    c.stdout.emit("data", Buffer.from(data));
    c.emit("exit", code, null);
  });
  return c;
}

/** Replace `slug`'s default (env-null) binding with `actionSlug`, overriding the
 *  seeded default so tests exercise exactly the action they name. */
function bindDefault(slug: string, actionSlug: string): void {
  const db = openDb(dbPath);
  const rid = (
    db.prepare("SELECT id FROM rules WHERE slug = ?").get(slug) as {
      id: number;
    }
  ).id;
  const aid = (
    db
      .prepare("SELECT id FROM action_types WHERE slug = ?")
      .get(actionSlug) as { id: number }
  ).id;
  db.prepare(
    "DELETE FROM rule_actions WHERE rule_id = ? AND environment_id IS NULL",
  ).run(rid);
  db.prepare(
    "INSERT INTO rule_actions (rule_id, environment_id, action_type_id) VALUES (?, NULL, ?)",
  ).run(rid, aid);
  db.close();
}

/** Swap a rule's `script` fix from a scriptPath to a shell scriptBody. */
function useShellFix(slug: string, body: string): void {
  const db = openDb(dbPath);
  const rid = (
    db.prepare("SELECT id FROM rules WHERE slug = ?").get(slug) as {
      id: number;
    }
  ).id;
  db.prepare(
    "UPDATE fixes SET script_path = NULL, script_body = ? WHERE rule_id = ? AND kind = 'script'",
  ).run(body, rid);
  db.close();
}

/** Also run `slug` at `stage` (lint-prettier ships pre-commit only). */
function addStage(slug: string, stage: string): void {
  const db = openDb(dbPath);
  const rid = (
    db.prepare("SELECT id FROM rules WHERE slug = ?").get(slug) as {
      id: number;
    }
  ).id;
  db.prepare("INSERT INTO rule_stages (rule_id, stage) VALUES (?, ?)").run(
    rid,
    stage,
  );
  db.close();
}

interface FixMock {
  staged?: string;
  fixCode?: number;
  checkCode?: number;
  addCode?: number;
  diffFails?: boolean;
}

/** Route each spawn by command: git diff/add, the `--fix` run, and the plain check. */
function mockFixRun({
  staged = "a.ts\nb.ts\n",
  fixCode = 0,
  checkCode = 0,
  addCode = 0,
  diffFails = false,
}: FixMock = {}): void {
  spawnMock.mockImplementation(((cmd: string, args: string[]) => {
    if (cmd === "git" && args[0] === "diff") {
      return diffFails
        ? fakeChild((c) => c.emit("exit", 1, null))
        : childWithStdout(staged, 0);
    }
    if (cmd === "git" && args[0] === "add") {
      return fakeChild((c) => c.emit("exit", addCode, null));
    }
    if (args.includes("--fix"))
      return fakeChild((c) => c.emit("exit", fixCode, null));
    return fakeChild((c) => c.emit("exit", checkCode, null));
  }) as never);
}

/** [command, args] for every spawn, so tests match without pinning absolute paths. */
function spawnCalls(): [string, string[]][] {
  return spawnMock.mock.calls.map(([cmd, args]) => [
    cmd as string,
    args as string[],
  ]);
}
const fixRun = (calls: [string, string[]][]) =>
  calls.find(
    ([cmd, args]) => cmd === process.execPath && args.includes("--fix"),
  );
const checkRun = (calls: [string, string[]][]) =>
  calls.find(
    ([cmd, args]) =>
      cmd === process.execPath &&
      !args.includes("--fix") &&
      args.includes("--staged"),
  );
const gitAdd = (calls: [string, string[]][]) =>
  calls.find(([cmd, args]) => cmd === "git" && args[0] === "add");

describe("runDispatch fix actions", () => {
  it("fix_and_halt: runs the fix, re-stages, then halts on remaining violations", async () => {
    isolatePreCommit("lint-prettier");
    bindDefault("lint-prettier", "fix_and_halt");
    mockFixRun({ staged: "a.ts\nb.ts\n", fixCode: 0, checkCode: 2 });

    await expect(runDispatch(["pre-commit"])).rejects.toThrow("process.exit:2");
    expect(exitSpy).toHaveBeenCalledWith(2);
    const calls = spawnCalls();
    expect(fixRun(calls)?.[1]).toContain("--fix");
    expect(gitAdd(calls)).toEqual(["git", ["add", "--", "a.ts", "b.ts"]]);
    expect(checkRun(calls)).toBeDefined();
    expect(recordedRuns()).toEqual([
      { slug: "lint-prettier", stage: "pre-commit", status: "failure" },
    ]);
  });

  it("fix_and_warn: runs the fix and re-checks but never fails the stage", async () => {
    isolatePreCommit("lint-prettier");
    bindDefault("lint-prettier", "fix_and_warn");
    mockFixRun({ checkCode: 1 });

    await expect(runDispatch(["pre-commit"])).resolves.toBeUndefined();
    expect(exitSpy).not.toHaveBeenCalled();
    expect(checkRun(spawnCalls())).toBeDefined();
  });

  it("fix: runs the fix, never runs the check, and never blocks", async () => {
    isolatePreCommit("lint-prettier");
    bindDefault("lint-prettier", "fix");
    mockFixRun({ fixCode: 0 });

    await expect(runDispatch(["pre-commit"])).resolves.toBeUndefined();
    const calls = spawnCalls();
    expect(fixRun(calls)).toBeDefined();
    expect(checkRun(calls)).toBeUndefined();
    expect(recordedRuns()).toEqual([
      { slug: "lint-prettier", stage: "pre-commit", status: "success" },
    ]);
  });

  it("skips the fix at pre-push and applies the gate to the check", async () => {
    const db = openDb(dbPath);
    db.prepare("UPDATE rules SET enabled = 0 WHERE slug != ?").run(
      "lint-prettier",
    );
    db.close();
    addStage("lint-prettier", "pre-push");
    bindDefault("lint-prettier", "fix_and_halt");
    mockFixRun({ checkCode: 2 });

    await expect(runDispatch(["pre-push"])).rejects.toThrow("process.exit:2");
    const calls = spawnCalls();
    expect(fixRun(calls)).toBeUndefined();
    expect(gitAdd(calls)).toBeUndefined();
    expect(
      calls.find(([cmd, args]) => cmd === "git" && args[0] === "diff"),
    ).toBeUndefined();
  });

  it("treats a null fix exit code as success", async () => {
    isolatePreCommit("lint-prettier");
    bindDefault("lint-prettier", "fix_and_warn");
    spawnMock.mockImplementation(((cmd: string, args: string[]) => {
      if (cmd === "git" && args[0] === "diff")
        return childWithStdout("a.ts\n", 0);
      if (args.includes("--fix"))
        return fakeChild((c) => c.emit("exit", null, null));
      return fakeChild((c) => c.emit("exit", 0, null));
    }) as never);

    await expect(runDispatch(["pre-commit"])).resolves.toBeUndefined();
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it("rejects when the fix child is killed by a signal, still logging a failure", async () => {
    isolatePreCommit("lint-prettier");
    bindDefault("lint-prettier", "fix_and_halt");
    spawnMock.mockImplementation(((cmd: string, args: string[]) => {
      if (cmd === "git" && args[0] === "diff")
        return childWithStdout("a.ts\n", 0);
      if (args.includes("--fix"))
        return fakeChild((c) => c.emit("exit", null, "SIGTERM"));
      return fakeChild((c) => c.emit("exit", 0, null));
    }) as never);

    await expect(runDispatch(["pre-commit"])).rejects.toThrow(
      /fix killed by SIGTERM/,
    );
    expect(recordedRuns()).toEqual([
      { slug: "lint-prettier", stage: "pre-commit", status: "failure" },
    ]);
  });

  it("rejects when re-staging fails, still logging a failure", async () => {
    isolatePreCommit("lint-prettier");
    bindDefault("lint-prettier", "fix_and_halt");
    mockFixRun({ addCode: 1 });

    await expect(runDispatch(["pre-commit"])).rejects.toThrow(/git add exited 1/);
    expect(recordedRuns()).toEqual([
      { slug: "lint-prettier", stage: "pre-commit", status: "failure" },
    ]);
  });

  it("runs a shell scriptBody fix over the staged files", async () => {
    isolatePreCommit("lint-prettier");
    useShellFix("lint-prettier", "prettier --write");
    bindDefault("lint-prettier", "fix_and_warn");
    mockFixRun({ staged: "a.ts\nb.ts\n", checkCode: 0 });

    await expect(runDispatch(["pre-commit"])).resolves.toBeUndefined();
    const calls = spawnCalls();
    expect(calls).toContainEqual(["prettier", ["--write", "a.ts", "b.ts"]]);
  });

  it("skips a shell scriptBody fix when nothing is staged", async () => {
    isolatePreCommit("lint-prettier");
    useShellFix("lint-prettier", "prettier --write");
    bindDefault("lint-prettier", "fix");
    mockFixRun({ staged: "", checkCode: 0 });

    await expect(runDispatch(["pre-commit"])).resolves.toBeUndefined();
    const calls = spawnCalls();
    expect(calls.some(([cmd]) => cmd === "prettier")).toBe(false);
    expect(gitAdd(calls)).toBeUndefined();
  });

  it("aborts when staged-file collection fails", async () => {
    isolatePreCommit("lint-prettier");
    bindDefault("lint-prettier", "fix_and_halt");
    mockFixRun({ diffFails: true });

    await expect(runDispatch(["pre-commit"])).rejects.toThrow(
      /git diff exited 1/,
    );
    // Staged-file collection precedes the per-rule loop, so no rule ran — the
    // guaranteed-log applies per rule the loop begins, not to setup failures.
    expect(recordedRuns()).toEqual([]);
  });
});
