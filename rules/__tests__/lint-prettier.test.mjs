import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

// Pass execFile through to the real binaries (git + prettier) so most tests
// exercise the actual toolchain. `prettierExecOverride`, when set, hijacks the
// prettier check invocation to simulate a spawn-level failure (no stdout/stderr,
// non-numeric code) — the only way to reach main's defensive error fallbacks
// since the hook exposes no exec injection seam. The hook wraps execFile with
// `promisify`, so we preserve the custom-promisified path and only intercept
// there (that is the code path the hook actually invokes).
let prettierExecOverride = null;
vi.mock("node:child_process", async () => {
  const actual = await vi.importActual("node:child_process");
  const realPromisified = promisify(actual.execFile);
  function execFile(...args) {
    return actual.execFile(...args);
  }
  execFile[promisify.custom] = (cmd, args, opts) => {
    if (
      prettierExecOverride &&
      Array.isArray(args) &&
      args.includes("--check")
    ) {
      return Promise.reject(prettierExecOverride());
    }
    return realPromisified(cmd, args, opts);
  };
  return { ...actual, execFile };
});

const { main, parsePrettierCheckOutput, selectMode } =
  await import("../lint-prettier/check.mjs");
const { cleanupTmp, commitAllIn, makeTempGitRepo } =
  await import("./test-helpers.mjs");

const FORMATTED = "const x = 1;\n";
const UNFORMATTED = "const x=1\n";
const BROKEN = "const = ;\n";

describe("lint-prettier / selectMode", () => {
  test("--staged is a check over the staged selection", () => {
    expect(selectMode(["--staged"])).toEqual({
      op: "check",
      selector: "--staged",
      warn: false,
      files: [],
    });
  });

  test("--all is a check over all files", () => {
    expect(selectMode(["--all"])).toMatchObject({
      op: "check",
      selector: "--all",
    });
  });

  test("--files keeps the trailing paths", () => {
    expect(selectMode(["--files", "a.ts", "b.tsx"])).toEqual({
      op: "check",
      selector: "--files",
      warn: false,
      files: ["a.ts", "b.tsx"],
    });
  });

  test("--warn marks the check advisory", () => {
    expect(selectMode(["--staged", "--warn"])).toMatchObject({
      op: "check",
      warn: true,
    });
  });

  test("--fix alone defaults to the staged selection", () => {
    expect(selectMode(["--fix"])).toMatchObject({
      op: "fix",
      selector: "--staged",
    });
  });

  test("--fix combines with a selector", () => {
    expect(selectMode(["--fix", "--all"])).toMatchObject({
      op: "fix",
      selector: "--all",
    });
    expect(selectMode(["--fix", "--files", "a.ts"])).toEqual({
      op: "fix",
      selector: "--files",
      warn: false,
      files: ["a.ts"],
    });
  });

  test("an unknown selector is rejected", () => {
    expect(selectMode(["--bogus"])).toBeNull();
    expect(selectMode([])).toBeNull();
  });
});

describe("lint-prettier / parsePrettierCheckOutput", () => {
  test("one violation per [warn] file line", () => {
    const out = "[warn] src/a.ts\n[warn] src/b.tsx\n";
    const v = parsePrettierCheckOutput(out);
    expect(v).toHaveLength(2);
    expect(v[0]).toMatchObject({
      path: "src/a.ts",
      line: 1,
      col: 1,
      kind: "not prettier-formatted",
    });
    expect(v[1].path).toBe("src/b.tsx");
  });

  test("clean output yields no violations", () => {
    expect(
      parsePrettierCheckOutput("All matched files use Prettier code style!\n"),
    ).toEqual([]);
  });

  test("the summary [warn] line is not mistaken for a file", () => {
    const out =
      "[warn] src/a.ts\n[warn] Code style issues found in the above file. Run Prettier with --write to fix.\n";
    const v = parsePrettierCheckOutput(out);
    expect(v).toHaveLength(1);
    expect(v[0].path).toBe("src/a.ts");
  });
});

describe("lint-prettier / main (real prettier)", () => {
  let repo;
  let origCwd;
  let exitSpy;
  let stderrSpy;
  let stdoutSpy;
  beforeEach(async () => {
    repo = await makeTempGitRepo("lp-main-");
    origCwd = process.cwd();
    process.chdir(repo);
    exitSpy = vi.spyOn(process, "exit").mockImplementation((code) => {
      throw new Error(`__exit__:${code}`);
    });
    stderrSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    stdoutSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);
  });
  afterEach(async () => {
    process.chdir(origCwd);
    exitSpy.mockRestore();
    stderrSpy.mockRestore();
    stdoutSpy.mockRestore();
    await cleanupTmp(repo);
  });

  const stderrText = () => stderrSpy.mock.calls.map((c) => c[0]).join("");
  const stdoutText = () => stdoutSpy.mock.calls.map((c) => c[0]).join("");

  test("an unrecognized selector prints USAGE and exits 2", async () => {
    await expect(main(["node", "s.mjs", "--bogus"])).rejects.toThrow(
      /__exit__:2/,
    );
    expect(stderrText()).toMatch(/Usage:/);
  });

  test("no lintable files prints the no-op line", async () => {
    await writeFile(join(repo, "notes.md"), "hi\n", "utf8");
    await main(["node", "s.mjs", "--files", join(repo, "notes.md")]);
    expect(exitSpy).not.toHaveBeenCalled();
    expect(stdoutText()).toMatch(/no lintable files/);
  });

  test("a formatted file passes the check", async () => {
    const p = join(repo, "good.ts");
    await writeFile(p, FORMATTED, "utf8");
    await main(["node", "s.mjs", "--files", p]);
    expect(exitSpy).not.toHaveBeenCalled();
    expect(stdoutText()).toMatch(/all files formatted/);
  });

  test("an unformatted file fails the check and exits 1", async () => {
    const p = join(repo, "bad.ts");
    await writeFile(p, UNFORMATTED, "utf8");
    await expect(main(["node", "s.mjs", "--files", p])).rejects.toThrow(
      /__exit__:1/,
    );
    expect(stderrText()).toMatch(/not prettier-formatted/);
    expect(stderrText()).toMatch(/unformatted file\(s\)/);
  });

  test("CO_JSON emits one JSON violations line and never exits", async () => {
    const p = join(repo, "bad.ts");
    await writeFile(p, UNFORMATTED, "utf8");
    process.env.CO_JSON = "1";
    try {
      await main(["node", "s.mjs", "--files", p]);
    } finally {
      delete process.env.CO_JSON;
    }
    expect(exitSpy).not.toHaveBeenCalled();
    const lines = stdoutText().split("\n").filter(Boolean);
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]).violations.length).toBeGreaterThan(0);
  });

  test("CO_JSON with no lintable files emits an empty JSON line", async () => {
    const p = join(repo, "notes.md");
    await writeFile(p, "# hi\n", "utf8");
    process.env.CO_JSON = "1";
    try {
      await main(["node", "s.mjs", "--files", p]);
    } finally {
      delete process.env.CO_JSON;
    }
    expect(exitSpy).not.toHaveBeenCalled();
    expect(JSON.parse(stdoutText().trim())).toEqual({ violations: [] });
  });

  test("an unformatted file under --warn is advisory and does not exit", async () => {
    const p = join(repo, "warn.ts");
    await writeFile(p, UNFORMATTED, "utf8");
    await main(["node", "s.mjs", "--files", p, "--warn"]);
    expect(exitSpy).not.toHaveBeenCalled();
    expect(stderrText()).toMatch(/advisory — not blocking/);
  });

  test("a syntactically broken file surfaces the prettier error as a throw", async () => {
    const p = join(repo, "broken.ts");
    await writeFile(p, BROKEN, "utf8");
    await expect(main(["node", "s.mjs", "--files", p])).rejects.toThrow(
      /prettier failed/,
    );
  });

  test("--fix rewrites an unformatted file with prettier --write", async () => {
    const p = join(repo, "fixme.ts");
    await writeFile(p, UNFORMATTED, "utf8");
    await main(["node", "s.mjs", "--fix", "--files", p]);
    expect(exitSpy).not.toHaveBeenCalled();
    expect(await readFile(p, "utf8")).toBe(FORMATTED);
    expect(stdoutText()).toMatch(/formatted 1 file\(s\)/);
  });

  test("--staged over a clean repo reports all files formatted", async () => {
    await writeFile(join(repo, "clean.ts"), FORMATTED, "utf8");
    await commitAllIn(repo, "seed");
    // Stage a formatted change so the staged diff is non-empty.
    await writeFile(
      join(repo, "clean.ts"),
      FORMATTED + "const y = 2;\n",
      "utf8",
    );
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    await promisify(execFile)("git", ["add", "-A"], { cwd: repo });
    await main(["node", "s.mjs", "--staged"]);
    expect(exitSpy).not.toHaveBeenCalled();
    expect(stdoutText()).toMatch(/all files formatted/);
  });

  test("--all over a repo with an unformatted file exits 1", async () => {
    await writeFile(join(repo, "u.ts"), UNFORMATTED, "utf8");
    await commitAllIn(repo, "seed");
    await expect(main(["node", "s.mjs", "--all"])).rejects.toThrow(
      /__exit__:1/,
    );
    expect(stderrText()).toMatch(/not prettier-formatted/);
  });

  test("a spawn-level prettier failure (no output, non-numeric code) throws with err.message", async () => {
    // Simulate execFile rejecting before the child produced any stdout/stderr —
    // exercises main's `?? ""` and `stderr || stdout || err.message` fallbacks.
    prettierExecOverride = () =>
      Object.assign(new Error("spawn ENOENT"), { code: "ENOENT" });
    try {
      const p = join(repo, "any.ts");
      await writeFile(p, FORMATTED, "utf8");
      await expect(main(["node", "s.mjs", "--files", p])).rejects.toThrow(
        /prettier failed: spawn ENOENT/,
      );
    } finally {
      prettierExecOverride = null;
    }
  });
});
