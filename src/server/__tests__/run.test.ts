import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:child_process", () => ({
  spawn: vi.fn(),
  execFile: vi.fn((_cmd: string, _args: string[], cb: (e: unknown, r: unknown) => void) =>
    cb(null, { stdout: "true\n", stderr: "" }),
  ),
}));

import { execFile, spawn } from "node:child_process";
import { hookScriptPath } from "../../rules/dispatch.js";
import { browse, RUNNABLE_SLUGS, runMeta, runRules } from "../run.js";

const spawnMock = vi.mocked(spawn);
const execFileMock = vi.mocked(execFile);

interface ChildOpts {
  stdout?: string;
  stderr?: string;
  code?: number | null;
  err?: Error;
}

/** A fake child that emits stdout/stderr then closes on the next microtask, like a real spawn. */
function fakeChild(opts: ChildOpts): EventEmitter {
  const c = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
  };
  c.stdout = new EventEmitter();
  c.stderr = new EventEmitter();
  queueMicrotask(() => {
    if (opts.err) return c.emit("error", opts.err);
    if (opts.stdout) c.stdout.emit("data", opts.stdout);
    if (opts.stderr) c.stderr.emit("data", opts.stderr);
    c.emit("close", opts.code ?? 0);
  });
  return c;
}

const jsonLine = (violations: unknown[]) => JSON.stringify({ violations }) + "\n";
const V = { path: "a.ts", line: 1, col: 3, kind: "k", detail: "d" };

let dir: string;
let filePath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "co-run-"));
  mkdirSync(join(dir, "sub"));
  mkdirSync(join(dir, "node_modules"));
  mkdirSync(join(dir, ".hidden"));
  filePath = join(dir, "a.ts");
  writeFileSync(filePath, "const x = 1;\n");
  writeFileSync(join(dir, "readme.md"), "# doc\n");

  spawnMock.mockImplementation(
    () => fakeChild({ stdout: jsonLine([V]), code: 0 }) as never,
  );
  execFileMock.mockImplementation(((
    _cmd: string,
    _args: string[],
    cb: (e: unknown, r: unknown) => void,
  ) => cb(null, { stdout: "true\n", stderr: "" })) as never);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
  spawnMock.mockReset();
  execFileMock.mockReset();
});

describe("runMeta", () => {
  it("returns the cwd as root and the full runnable slug set", () => {
    const meta = runMeta();
    expect(meta.root).toBe(process.cwd());
    expect(meta.runnableSlugs).toEqual([...RUNNABLE_SLUGS]);
    expect(meta.runnableSlugs).toContain("lint-naming");
  });
});

describe("browse", () => {
  it("lists lintable files and non-hidden dirs, dirs first", async () => {
    const v = await browse(dir);
    expect(v.path).toBe(dir);
    expect(v.parent).not.toBeNull();
    // node_modules, .hidden, and readme.md (non-lintable) are all filtered out.
    expect(v.entries.map((e) => `${e.type}:${e.name}`)).toEqual([
      "dir:sub",
      "file:a.ts",
    ]);
    expect(v.entries[1].path).toBe(filePath);
  });

  it("defaults to the process cwd when no path is given", async () => {
    const v = await browse();
    expect(v.path).toBe(process.cwd());
  });

  it("reports a null parent at the filesystem root", async () => {
    const v = await browse("/");
    expect(v.parent).toBeNull();
  });

  it("rejects when the path is not a directory", async () => {
    await expect(browse(filePath)).rejects.toThrow();
  });
});

describe("runRules — validation", () => {
  it("throws when slugs is missing", async () => {
    await expect(runRules({})).rejects.toThrow("slugs is required");
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("throws when slugs is empty", async () => {
    await expect(runRules({ slugs: [] })).rejects.toThrow("slugs is required");
  });

  it("throws a clean error when the target does not exist", async () => {
    await expect(
      runRules({ slugs: ["lint-naming"], path: join(dir, "nope/x") }),
    ).rejects.toThrow(/no such file or folder/);
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("throws a clean error when the folder is not a git repo", async () => {
    execFileMock.mockImplementation(((
      _cmd: string,
      _args: string[],
      cb: (e: unknown) => void,
    ) => cb(new Error("fatal: not a git repository"))) as never);
    await expect(
      runRules({ slugs: ["lint-naming"], path: dir }),
    ).rejects.toThrow(`not a git repository (or missing folder): ${dir}`);
    expect(spawnMock).not.toHaveBeenCalled();
  });
});

describe("runRules — folder mode (--all)", () => {
  it("runs each rule over the whole folder", async () => {
    const results = await runRules({ slugs: ["lint-naming"], path: dir });
    expect(results).toEqual([{ slug: "lint-naming", ok: true, violations: [V] }]);
    const [cmd, args, opts] = spawnMock.mock.calls[0] as [
      string,
      string[],
      { cwd: string; env: Record<string, string> },
    ];
    expect(cmd).toBe(process.execPath);
    expect(args).toEqual([hookScriptPath("lint-naming"), "--all"]);
    expect(opts.cwd).toBe(dir);
    expect(opts.env.CO_JSON).toBe("1");
  });

  it("defaults the target to the process cwd", async () => {
    await runRules({ slugs: ["lint-naming"] });
    const opts = spawnMock.mock.calls[0][2] as { cwd: string };
    expect(opts.cwd).toBe(process.cwd());
  });

  it("dedupes slugs and preserves request order", async () => {
    const results = await runRules({
      slugs: ["lint-naming", "lint-naming", "lint-max-lines"],
      path: dir,
    });
    expect(results.map((r) => r.slug)).toEqual(["lint-naming", "lint-max-lines"]);
    expect(spawnMock).toHaveBeenCalledTimes(2);
  });
});

describe("runRules — file mode (--files)", () => {
  it("runs each rule over just the chosen file, from its parent dir", async () => {
    const results = await runRules({ slugs: ["lint-naming"], path: filePath });
    expect(results[0]).toEqual({ slug: "lint-naming", ok: true, violations: [V] });
    const [, args, opts] = spawnMock.mock.calls[0] as [
      string,
      string[],
      { cwd: string },
    ];
    expect(args).toEqual([hookScriptPath("lint-naming"), "--files", filePath]);
    expect(opts.cwd).toBe(dir);
  });
});

describe("runRules — per-rule outcomes", () => {
  it("reports a clean rule as ok with no violations", async () => {
    spawnMock.mockImplementation(
      () => fakeChild({ stdout: jsonLine([]), code: 0 }) as never,
    );
    const results = await runRules({ slugs: ["lint-naming"], path: dir });
    expect(results[0]).toEqual({ slug: "lint-naming", ok: true, violations: [] });
  });

  it("flags an unknown slug without spawning", async () => {
    const results = await runRules({ slugs: ["bogus"], path: dir });
    expect(results[0]).toEqual({
      slug: "bogus",
      ok: false,
      violations: [],
      error: "unknown rule",
    });
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("flags a known-but-not-wired rule without spawning", async () => {
    const results = await runRules({ slugs: ["lint-comments"], path: dir });
    expect(results[0].ok).toBe(false);
    expect(results[0].error).toBe("rule is not runnable from the panel yet");
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("surfaces the child's stderr on a non-zero exit", async () => {
    spawnMock.mockImplementation(
      () => fakeChild({ stderr: "boom\n", code: 2 }) as never,
    );
    const results = await runRules({ slugs: ["lint-naming"], path: dir });
    expect(results[0]).toEqual({
      slug: "lint-naming",
      ok: false,
      violations: [],
      error: "boom",
    });
  });

  it("reports a generic error when a non-zero exit has no stderr", async () => {
    spawnMock.mockImplementation(() => fakeChild({ code: 1 }) as never);
    const results = await runRules({ slugs: ["lint-naming"], path: dir });
    expect(results[0].error).toBe("exited 1 without JSON output");
  });

  it("errors when exit 0 produces no output line", async () => {
    spawnMock.mockImplementation(
      () => fakeChild({ stdout: "", code: 0 }) as never,
    );
    const results = await runRules({ slugs: ["lint-naming"], path: dir });
    expect(results[0].error).toBe("exited 0 without JSON output");
  });

  it("errors when the output line is not valid JSON", async () => {
    spawnMock.mockImplementation(
      () => fakeChild({ stdout: "not json\n", code: 0 }) as never,
    );
    const results = await runRules({ slugs: ["lint-naming"], path: dir });
    expect(results[0].error).toBe("exited 0 without JSON output");
  });

  it("errors when JSON lacks a violations array", async () => {
    spawnMock.mockImplementation(
      () => fakeChild({ stdout: '{"violations":5}\n', code: 0 }) as never,
    );
    const results = await runRules({ slugs: ["lint-naming"], path: dir });
    expect(results[0].ok).toBe(false);
  });

  it("errors when the JSON line parses to null", async () => {
    spawnMock.mockImplementation(
      () => fakeChild({ stdout: "null\n", code: 0 }) as never,
    );
    const results = await runRules({ slugs: ["lint-naming"], path: dir });
    expect(results[0].ok).toBe(false);
  });

  it("surfaces a spawn 'error' event as a per-rule failure", async () => {
    spawnMock.mockImplementation(
      () => fakeChild({ err: new Error("spawnfail") }) as never,
    );
    const results = await runRules({ slugs: ["lint-naming"], path: dir });
    expect(results[0]).toEqual({
      slug: "lint-naming",
      ok: false,
      violations: [],
      error: "spawnfail",
    });
  });
});
