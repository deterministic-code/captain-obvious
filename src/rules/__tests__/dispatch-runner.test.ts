import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:child_process", () => ({ spawn: vi.fn() }));

import { spawn } from "node:child_process";
import { openDb } from "../../db/open.js";
import { seedRules } from "../../db/seed.js";
import { runDispatch } from "../dispatch.js";
import { RULES } from "../index.js";

const spawnMock = vi.mocked(spawn);

const pkgRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/** A fake child that emits its outcome on the next microtask, like a real spawn. */
function fakeChild(emit: (c: EventEmitter) => void): EventEmitter {
  const c = new EventEmitter();
  queueMicrotask(() => emit(c));
  return c;
}

let dbPath: string;
let tmpDir: string;
const savedEnv = process.env.CAPTAIN_OBVIOUS_DB;

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
  rmSync(tmpDir, { recursive: true, force: true });
  vi.restoreAllMocks();
  spawnMock.mockReset();
});

describe("runDispatch", () => {
  it("runs a single blocking rule, resolving cleanly and never exiting", async () => {
    isolatePreCommit("lint-naming");
    await expect(runDispatch(["pre-commit"])).resolves.toBeUndefined();
    expect(exitSpy).not.toHaveBeenCalled();
    expect(spawnMock).toHaveBeenCalledTimes(1);

    const script = resolve(pkgRoot, "hooks", "git", "lint-naming.mjs");
    expect(spawnMock).toHaveBeenCalledWith(
      process.execPath,
      [script, "--staged"],
      { stdio: "inherit" },
    );
  });

  it("passes --push for the pre-push stage", async () => {
    // Keep whichever pre-push rule seeds first enabled; the default spawn passes.
    await expect(runDispatch(["pre-push"])).resolves.toBeUndefined();
    const args = spawnMock.mock.calls[0][1] as string[];
    expect(args[1]).toBe("--push");
  });

  it("exits with the child's code on a blocking failure and stops", async () => {
    isolatePreCommit("lint-naming");
    spawnMock.mockImplementationOnce(
      () => fakeChild((c) => c.emit("exit", 2, null)) as never,
    );
    await expect(runDispatch(["pre-commit"])).rejects.toThrow("process.exit:2");
    expect(exitSpy).toHaveBeenCalledWith(2);
    expect(spawnMock).toHaveBeenCalledTimes(1);
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

  it("rejects when the child is killed by a signal", async () => {
    isolatePreCommit("lint-naming");
    spawnMock.mockImplementationOnce(
      () => fakeChild((c) => c.emit("exit", null, "SIGKILL")) as never,
    );
    await expect(runDispatch(["pre-commit"])).rejects.toThrow(
      /killed by SIGKILL/,
    );
  });

  it("rejects when the child emits an error", async () => {
    isolatePreCommit("lint-naming");
    spawnMock.mockImplementationOnce(
      () => fakeChild((c) => c.emit("error", new Error("boom"))) as never,
    );
    await expect(runDispatch(["pre-commit"])).rejects.toThrow(/boom/);
  });

  it("rejects on an invalid stage before spawning", async () => {
    await expect(runDispatch(["bogus"])).rejects.toThrow(
      /expected stage 'pre-commit' or 'pre-push'/,
    );
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("rejects with (none) when no stage is given", async () => {
    await expect(runDispatch([])).rejects.toThrow(/\(none\)/);
    expect(spawnMock).not.toHaveBeenCalled();
  });
});
