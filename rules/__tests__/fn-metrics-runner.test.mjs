import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  analyzeSource,
  parseSourceFile,
  runMetricHook,
} from "../_kit/fn-metrics.mjs";
import {
  commitAllIn,
  gitIn,
  makeTempGitRepo,
  mockProcessIo,
} from "./test-helpers.mjs";

// runMetricHook resolves --staged/--all files and stagedAddedLines via git in
// process.cwd(), so the runner suite chdir's into a throwaway repo per test.
const withCwd = async (dir, fn) => {
  const prev = process.cwd();
  process.chdir(dir);
  try {
    return await fn();
  } finally {
    process.chdir(prev);
  }
};

const OVER_COMPLEXITY = [
  "export function big(x) {",
  ...Array.from({ length: 20 }, (_, i) => `  if (x === ${i}) return ${i};`),
  "  return -1;",
  "}",
  "",
].join("\n");

const CLEAN = "export function ok(a) {\n  return a + 1;\n}\n";

describe("fn-metrics / parseSourceFile + functionName property forms", () => {
  test("a .tsx path is parsed as TSX (JSX is not misread as a comparison)", () => {
    const sf = parseSourceFile("c.tsx", "const el = <div>hi</div>;\n");
    expect(sf.fileName).toBe("c.tsx");
    // A TS (non-TSX) parse would choke on <div>; TSX parse yields no jsx-less error.
    expect(analyzeSource("c.tsx", "const f = () => <div>{1}</div>;\n")).toEqual(
      [expect.objectContaining({ name: '"f"' })],
    );
  });

  test("object-property and class-property functions take their property name", () => {
    const src = [
      "const obj = { run() { return 1; }, go: function () { return 2; } };",
      "class C { handler = () => 3; }",
      "[1].reduce((acc) => acc);",
      "",
    ].join("\n");
    const names = analyzeSource("p.ts", src).map((fn) => fn.name);
    expect(names).toContain('"run"');
    expect(names).toContain('"go"');
    expect(names).toContain('"handler"');
    // The bare arrow passed to reduce matches no name/property form → anonymous.
    expect(names).toContain("(anonymous)");
  });

  test("codeLineCount tolerates end lines past the split-on-\\n array", () => {
    // TypeScript counts a lone CR as a line break; JS split("\n") does not. So a
    // CR-delimited source yields an endLine beyond the stripped-lines array, and
    // codeLineCount must read those missing indices as "" (the `?? ""` guard)
    // rather than throwing on undefined.trim().
    const fns = analyzeSource("t.ts", "function f() {\r  return 1;\r}");
    expect(fns).toHaveLength(1);
    expect(fns[0].endLine).toBe(3);
    expect(fns[0].lines).toBe(1);
  });
});

describe("fn-metrics / runMetricHook", () => {
  let repo;
  let io;

  beforeEach(async () => {
    repo = await makeTempGitRepo("fn-metrics-runner-");
    io = mockProcessIo();
  });
  afterEach(async () => {
    io.restore();
    await rm(repo, { recursive: true, force: true, maxRetries: 5 });
  });

  test("--files clean pass writes an OK line and does not exit", async () => {
    await writeFile(join(repo, "clean.ts"), CLEAN, "utf8");
    await withCwd(repo, () =>
      runMetricHook("complexity", [
        "node",
        "hook",
        "--files",
        join(repo, "clean.ts"),
      ]),
    );
    expect(io.exitSpy).not.toHaveBeenCalled();
    expect(io.text(io.stdoutSpy)).toContain(
      "lint-complexity: no complexity violations.",
    );
  });

  test("a config override tightens the limit (panel edit reaches the check)", async () => {
    // The clean fn has complexity 1; lowering the limit to 0 via config makes it
    // violate — proving the resolved config, not the FN_LIMITS default, drives it.
    await writeFile(join(repo, "clean.ts"), CLEAN, "utf8");
    const tighten = async () => ({ maxComplexity: 0 });
    await withCwd(repo, () =>
      expect(
        runMetricHook(
          "complexity",
          ["node", "hook", "--files", join(repo, "clean.ts")],
          tighten,
        ),
      ).rejects.toThrow("__exit__:1"),
    );
    expect(io.text(io.stderrSpy)).toContain("(limit 0)");
  });

  test("--files over-limit reports each violation and exits 1", async () => {
    await writeFile(join(repo, "big.ts"), OVER_COMPLEXITY, "utf8");
    await withCwd(repo, () =>
      expect(
        runMetricHook("complexity", [
          "node",
          "hook",
          "--files",
          join(repo, "big.ts"),
        ]),
      ).rejects.toThrow("__exit__:1"),
    );
    const err = io.text(io.stderrSpy);
    expect(err).toContain("cyclomatic complexity");
    expect(err).toContain("violation(s)");
    expect(err).toContain("split the function or extract a helper");
  });

  test("params violation surfaces the parameters-specific advice", async () => {
    await writeFile(
      join(repo, "many.ts"),
      "export function f(a, b, c, d) { return a; }\n",
      "utf8",
    );
    await withCwd(repo, () =>
      expect(
        runMetricHook("params", [
          "node",
          "hook",
          "--files",
          join(repo, "many.ts"),
        ]),
      ).rejects.toThrow("__exit__:1"),
    );
    expect(io.text(io.stderrSpy)).toContain(
      "group related arguments into a single options object",
    );
  });

  test("--files skips a non-analyzable path (test file) as a clean pass", async () => {
    await writeFile(join(repo, "x.test.ts"), OVER_COMPLEXITY, "utf8");
    await withCwd(repo, () =>
      runMetricHook("complexity", [
        "node",
        "hook",
        "--files",
        join(repo, "x.test.ts"),
      ]),
    );
    expect(io.exitSpy).not.toHaveBeenCalled();
    expect(io.text(io.stdoutSpy)).toContain("no complexity violations.");
  });

  test("--files tolerates a missing path (ENOENT) as no violations", async () => {
    await withCwd(repo, () =>
      runMetricHook("lines", [
        "node",
        "hook",
        "--files",
        join(repo, "gone.ts"),
      ]),
    );
    expect(io.exitSpy).not.toHaveBeenCalled();
    expect(io.text(io.stdoutSpy)).toContain("no max-lines violations.");
  });

  test("an unexpected read error (EISDIR) propagates instead of being swallowed", async () => {
    await mkdir(join(repo, "adir.ts"), { recursive: true });
    await withCwd(repo, () =>
      expect(
        runMetricHook("lines", [
          "node",
          "hook",
          "--files",
          join(repo, "adir.ts"),
        ]),
      ).rejects.toThrow(/EISDIR/),
    );
  });

  test("--all audits every tracked file and passes on a clean tree", async () => {
    await writeFile(join(repo, "clean.ts"), CLEAN, "utf8");
    await commitAllIn(repo, "clean tree");
    await withCwd(repo, () =>
      runMetricHook("complexity", ["node", "hook", "--all"]),
    );
    expect(io.exitSpy).not.toHaveBeenCalled();
    expect(io.text(io.stdoutSpy)).toContain("no complexity violations.");
  });

  test("--staged scopes to added lines: only the staged over-limit fn is flagged", async () => {
    await writeFile(join(repo, "clean.ts"), CLEAN, "utf8");
    await commitAllIn(repo, "baseline");
    await writeFile(join(repo, "big.ts"), OVER_COMPLEXITY, "utf8");
    await gitIn(repo, ["add", "big.ts"]);
    await withCwd(repo, () =>
      expect(
        runMetricHook("complexity", ["node", "hook", "--staged"]),
      ).rejects.toThrow("__exit__:1"),
    );
    const err = io.text(io.stderrSpy);
    expect(err).toContain("big.ts");
    expect(err).not.toContain("clean.ts");
  });

  test("--staged ignores a pre-existing over-limit fn with no added lines", async () => {
    // Commit an over-limit fn, then stage an edit that only touches a second,
    // clean fn far below it. functionsInDiff must drop the untouched offender
    // (its span holds no added line → the `return false` path), so the run passes.
    const trailing = "\nexport function tail(a) {\n  return a;\n}\n";
    await writeFile(join(repo, "mixed.ts"), OVER_COMPLEXITY + trailing, "utf8");
    await commitAllIn(repo, "baseline with a pre-existing offender");
    await writeFile(
      join(repo, "mixed.ts"),
      OVER_COMPLEXITY + trailing.replace("return a;", "return a + 1;"),
      "utf8",
    );
    await gitIn(repo, ["add", "mixed.ts"]);
    await withCwd(repo, () =>
      runMetricHook("complexity", ["node", "hook", "--staged"]),
    );
    expect(io.exitSpy).not.toHaveBeenCalled();
    expect(io.text(io.stdoutSpy)).toContain(
      "no complexity violations in staged diff.",
    );
  });

  test("--staged clean pass appends the 'in staged diff' qualifier", async () => {
    await writeFile(join(repo, "clean.ts"), CLEAN, "utf8");
    await gitIn(repo, ["add", "clean.ts"]);
    await withCwd(repo, () =>
      runMetricHook("complexity", ["node", "hook", "--staged"]),
    );
    expect(io.text(io.stdoutSpy)).toContain(
      "no complexity violations in staged diff.",
    );
  });

  test("CO_JSON emits one JSON violations line and never exits", async () => {
    await writeFile(join(repo, "big.ts"), OVER_COMPLEXITY, "utf8");
    await commitAllIn(repo, "over-limit tree");
    process.env.CO_JSON = "1";
    try {
      await withCwd(repo, () =>
        runMetricHook("complexity", ["node", "hook", "--all"]),
      );
    } finally {
      delete process.env.CO_JSON;
    }
    expect(io.exitSpy).not.toHaveBeenCalled();
    expect(io.text(io.stderrSpy)).toBe("");
    const lines = io.text(io.stdoutSpy).split("\n").filter(Boolean);
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]);
    expect(parsed.violations[0]).toMatchObject({ kind: "complexity" });
  });

  test("an unknown mode prints usage and exits 2", async () => {
    await withCwd(repo, () =>
      expect(
        runMetricHook("lines", ["node", "hook", "--bogus"]),
      ).rejects.toThrow("__exit__:2"),
    );
    expect(io.text(io.stderrSpy)).toContain("Usage (JS/TS only");
  });
});
