import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:child_process", () => ({ spawn: vi.fn() }));

import { spawn } from "node:child_process";
import { listHookRuns, listLogs, openAuditDb } from "../../db/audit.js";
import type { Db } from "../../db/open.js";
import { dispatchGuard, dispatchRule, modifiedFiles } from "../runner.js";

const spawnMock = vi.mocked(spawn);

type FakeChild = EventEmitter & {
  stdio: (EventEmitter | null)[];
  stdout: EventEmitter;
  stderr: EventEmitter;
};

/** A fake child with an fd-3 pipe plus stdout/stderr, emitting on the next microtask. */
function fakeChild(emit: (c: FakeChild) => void): FakeChild {
  const c = Object.assign(new EventEmitter(), {
    stdio: [null, null, null, new EventEmitter()] as (EventEmitter | null)[],
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
  }) as FakeChild;
  queueMicrotask(() => emit(c));
  return c;
}

let audit: Db;

beforeEach(() => {
  audit = openAuditDb(":memory:");
});
afterEach(() => {
  audit.close();
  vi.restoreAllMocks();
  spawnMock.mockReset();
});

/** The log stream in chronological order (listLogs is newest-first). */
function logTypes(): string[] {
  return listLogs(audit)
    .map((l) => l.logType)
    .reverse();
}

const spec = (mode: "check" | "json" | "fix") => ({
  slug: "lint-naming",
  stage: "pre-commit",
  cwd: "/x",
  args: ["--staged"],
  mode,
});

describe("dispatchRule", () => {
  it("brackets a check with run.start/run.end and records the found count", async () => {
    spawnMock.mockImplementation(
      () =>
        fakeChild((c) => {
          c.stdio[3]!.emit("data", Buffer.from('{"found":3}\n'));
          c.emit("exit", 0, null);
        }) as never,
    );
    const outcome = await dispatchRule(audit, spec("check"));
    expect(outcome.found).toBe(3);
    expect(logTypes()).toEqual(["run.start", "run.end"]);
    expect(listHookRuns(audit)[0]).toMatchObject({
      slug: "lint-naming",
      stage: "pre-commit",
      status: "success",
      found: 3,
    });
    const end = listLogs(audit)[0];
    expect(end.message).toBe("pre-commit/lint-naming — 3 issue(s) found");
  });

  it("logs run.error and a failure row when the child is killed", async () => {
    spawnMock.mockImplementation(
      () => fakeChild((c) => c.emit("exit", null, "SIGKILL")) as never,
    );
    await expect(dispatchRule(audit, spec("check"))).rejects.toThrow(
      /killed by SIGKILL/,
    );
    expect(logTypes()).toEqual(["run.start", "run.error"]);
    expect(listHookRuns(audit)[0]).toMatchObject({ status: "failure" });
  });

  it("reports the violation count in the end message for a json run", async () => {
    spawnMock.mockImplementation(
      () =>
        fakeChild((c) => {
          c.stdout.emit(
            "data",
            Buffer.from('{"violations":[{"line":1},{"line":2}]}\n'),
          );
          c.emit("close", 0, null);
        }) as never,
    );
    const outcome = await dispatchRule(audit, spec("json"));
    expect(outcome.violations).toHaveLength(2);
    expect(listLogs(audit)[0].message).toBe(
      "pre-commit/lint-naming — 2 issue(s)",
    );
  });
});

describe("modifiedFiles", () => {
  it("extracts the reformatted paths from the runner's fix output", () => {
    const out = [
      "lint-prettier: formatted 2 file(s):",
      "  src/a.ts",
      "  src/b.ts",
      "Re-stage them with `git add`.",
    ].join("\n");
    expect(modifiedFiles(out)).toEqual(["src/a.ts", "src/b.ts"]);
  });

  it("strips ` <n>ms` timings and skips (unchanged) lines from a raw formatter", () => {
    const out = "a.ts 12ms\nb.ts 3ms (unchanged)\nc.ts 5ms\n";
    expect(modifiedFiles(out)).toEqual(["a.ts", "c.ts"]);
  });

  it("returns nothing when the formatter rewrote no files", () => {
    expect(modifiedFiles("")).toEqual([]);
  });
});

describe("dispatchGuard", () => {
  it("logs an allow as a success run", async () => {
    const verdict = await dispatchGuard(audit, "gov-x", "tool", () => ({
      deny: false,
    }));
    expect(verdict.deny).toBe(false);
    expect(logTypes()).toEqual(["run.start", "run.end"]);
    expect(listHookRuns(audit)[0]).toMatchObject({
      slug: "gov-x",
      stage: "tool",
      status: "success",
    });
    expect(listLogs(audit)[0].message).toBe("tool/gov-x — allowed");
  });

  it("logs a deny as a failure run and returns the verdict", async () => {
    const verdict = await dispatchGuard(audit, "gov-x", "stop", () =>
      Promise.resolve({ deny: true, reason: "blocked" }),
    );
    expect(verdict).toEqual({ deny: true, reason: "blocked" });
    expect(listHookRuns(audit)[0]).toMatchObject({ status: "failure" });
    expect(listLogs(audit)[0].message).toBe("stop/gov-x — denied");
  });

  it("logs run.error when the evaluator throws", async () => {
    await expect(
      dispatchGuard(audit, "gov-x", "tool", () => {
        throw new Error("git blew up");
      }),
    ).rejects.toThrow("git blew up");
    expect(logTypes()).toEqual(["run.start", "run.error"]);
    expect(listHookRuns(audit)[0]).toMatchObject({ status: "failure" });
  });
});
