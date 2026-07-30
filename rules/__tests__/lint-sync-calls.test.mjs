import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEVOPS_ALLOWLIST,
  findViolations,
  formatViolation,
  isDevopsAllowlisted,
  isLintable,
  lintFile,
  main,
  SUPPORTED_EXTS,
} from "../lint-sync-calls/check.mjs";
import { cleanupTmp, commitAllIn, makeTempGitRepo } from "./test-helpers.mjs";

describe("findViolations", () => {
  test("clean source with only async I/O returns no violations", () => {
    const src = `import { readFile } from "node:fs/promises";\nawait readFile("x");\n`;
    expect(findViolations(src)).toEqual([]);
  });

  test("a readFileSync call is flagged with line/col and detail", () => {
    const src = `import fs from "node:fs";\nconst x = fs.readFileSync("p");\n`;
    const v = findViolations(src);
    expect(v.length).toBe(1);
    expect(v[0].kind).toBe("sync call");
    expect(v[0].line).toBe(2);
    expect(v[0].col).toBeGreaterThan(0);
    expect(v[0].detail).toMatch(/readFileSync\(\) blocks the event loop/);
  });

  test("multiple distinct sync APIs each flag once", () => {
    const src = `existsSync("a");\nexecSync("ls");\nspawnSync("x");\n`;
    const v = findViolations(src);
    expect(v.map((x) => x.line)).toEqual([1, 2, 3]);
  });

  test("a sync API name inside a string literal is not flagged", () => {
    const src = `const s = "readFileSync(";\n`;
    expect(findViolations(src)).toEqual([]);
  });

  test("a sync API name inside a comment is not flagged", () => {
    const src = `// existsSync(\nconst x = 1;\n`;
    expect(findViolations(src)).toEqual([]);
  });

  test("a sync-like substring without a word boundary does not match", () => {
    const src = `myReadFileSync2("p");\n`;
    // `\bexistsSync` etc. require a boundary; the `2` suffix + prefix breaks it.
    expect(findViolations(src)).toEqual([]);
  });
});

describe("isDevopsAllowlisted and isLintable", () => {
  test("an exact devops-allowlisted script path is allowlisted", () => {
    expect(isDevopsAllowlisted("scripts/hooks/install-git-hooks.mjs")).toBe(
      true,
    );
  });

  test("a nested repo prefix on an allowlisted path still matches by suffix", () => {
    expect(
      isDevopsAllowlisted("pkg/scripts/hooks/install-git-hooks.mjs"),
    ).toBe(true);
  });

  test("a leading ./ is normalized before matching the allowlist", () => {
    expect(isDevopsAllowlisted("./backend/scripts/migrate.mjs")).toBe(true);
  });

  test("a non-allowlisted script path is not allowlisted", () => {
    expect(isDevopsAllowlisted("src/index.ts")).toBe(false);
  });

  test("isLintable is false for an excluded path", () => {
    expect(isLintable("node_modules/foo.ts")).toBe(false);
  });

  test("isLintable is false for a devops-allowlisted path even if .mjs", () => {
    expect(isLintable("scripts/deploy-droplet.mjs")).toBe(false);
  });

  test("isLintable is false for an unsupported extension", () => {
    expect(isLintable("src/notes.md")).toBe(false);
  });

  test("isLintable is true for a normal .ts source path", () => {
    expect(isLintable("src/foo.ts")).toBe(true);
  });

  test("SUPPORTED_EXTS is the JS/TS family", () => {
    for (const ext of [".ts", ".tsx", ".mjs", ".cjs", ".js", ".jsx"]) {
      expect(SUPPORTED_EXTS.has(ext)).toBe(true);
    }
  });

  test("DEVOPS_ALLOWLIST is a non-empty list of script paths", () => {
    expect(DEVOPS_ALLOWLIST.length).toBeGreaterThan(0);
    expect(DEVOPS_ALLOWLIST).toContain("scripts/deploy-droplet.mjs");
  });
});

describe("lintFile", () => {
  let tmpRoot;
  beforeEach(async () => {
    tmpRoot = await mkdtemp(join(tmpdir(), "lsc-file-"));
  });
  afterEach(async () => {
    await cleanupTmp(tmpRoot);
  });

  test("tags each violation with `.path`", async () => {
    const p = join(tmpRoot, "bad.ts");
    await writeFile(p, `existsSync("p");\n`, "utf8");
    const v = await lintFile(p);
    expect(v.length).toBe(1);
    expect(v[0].path).toBe(p);
  });

  test("returns [] for a missing file (ENOENT swallowed)", async () => {
    const v = await lintFile(join(tmpRoot, "nope.ts"));
    expect(v).toEqual([]);
  });

  test("rethrows a non-ENOENT read error (EISDIR on a directory)", async () => {
    await expect(lintFile(tmpRoot)).rejects.toMatchObject({ code: "EISDIR" });
  });
});

describe("formatViolation", () => {
  test("formats `path:line:col  kind` then indented detail", () => {
    expect(
      formatViolation({
        path: "src/x.ts",
        line: 3,
        col: 2,
        kind: "sync call",
        detail: "d",
      }),
    ).toBe("src/x.ts:3:2  sync call\n    d");
  });
});

describe("main", () => {
  let tmpRoot;
  let origCwd;
  let exitSpy;
  let stderrSpy;
  let stdoutSpy;
  beforeEach(async () => {
    tmpRoot = await mkdtemp(join(tmpdir(), "lsc-main-"));
    origCwd = process.cwd();
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
    await cleanupTmp(tmpRoot);
  });

  const stderrText = () => stderrSpy.mock.calls.map((c) => c[0]).join("");
  const stdoutText = () => stdoutSpy.mock.calls.map((c) => c[0]).join("");

  test("no/unknown mode prints usage and exits 2", async () => {
    await expect(main(["node", "script.mjs"])).rejects.toThrow(/__exit__:2/);
    expect(exitSpy).toHaveBeenCalledWith(2);
    expect(stderrText()).toMatch(/Usage:/);
  });

  test("--files with a clean file resolves without exit", async () => {
    const clean = join(tmpRoot, "clean.ts");
    await writeFile(clean, `await readFile("x");\n`, "utf8");
    await main(["node", "script.mjs", "--files", clean]);
    expect(exitSpy).not.toHaveBeenCalled();
  });

  test("--files with a sync call writes violations and exits 1", async () => {
    const bad = join(tmpRoot, "bad.ts");
    await writeFile(bad, `existsSync("p");\n`, "utf8");
    await expect(
      main(["node", "script.mjs", "--files", bad]),
    ).rejects.toThrow(/__exit__:1/);
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(stderrText()).toContain("sync call");
    expect(stderrText()).toMatch(/1 violation\(s\)/);
  });

  test("--staged over a clean repo prints the staged-diff OK line", async () => {
    const repo = await makeTempGitRepo("lsc-staged-");
    await writeFile(join(repo, "clean.ts"), `await readFile("x");\n`, "utf8");
    await commitAllIn(repo, "seed");
    process.chdir(repo);
    await main(["node", "script.mjs", "--staged"]);
    expect(exitSpy).not.toHaveBeenCalled();
    expect(stdoutText()).toMatch(/no sync calls in staged diff/);
    await cleanupTmp(repo);
  });

  test("--all over a repo with a sync call flags it and exits 1", async () => {
    const repo = await makeTempGitRepo("lsc-all-");
    await writeFile(join(repo, "bad.ts"), `existsSync("p");\n`, "utf8");
    await commitAllIn(repo, "seed");
    process.chdir(repo);
    await expect(main(["node", "script.mjs", "--all"])).rejects.toThrow(
      /__exit__:1/,
    );
    expect(stderrText()).toContain("sync call");
    await cleanupTmp(repo);
  });

  test("--all over a clean repo prints the in-repo OK line", async () => {
    const repo = await makeTempGitRepo("lsc-all-clean-");
    await writeFile(join(repo, "clean.ts"), `await readFile("x");\n`, "utf8");
    await commitAllIn(repo, "seed");
    process.chdir(repo);
    await main(["node", "script.mjs", "--all"]);
    expect(exitSpy).not.toHaveBeenCalled();
    expect(stdoutText()).toMatch(/no sync calls in repo/);
    await cleanupTmp(repo);
  });

  test("--all with CO_JSON emits one JSON violations line and never exits", async () => {
    const repo = await makeTempGitRepo("lsc-json-");
    await writeFile(join(repo, "bad.ts"), `existsSync("p");\n`, "utf8");
    await commitAllIn(repo, "seed");
    const prev = process.cwd();
    process.chdir(repo);
    process.env.CO_JSON = "1";
    try {
      await main(["node", "script.mjs", "--all"]);
    } finally {
      delete process.env.CO_JSON;
      process.chdir(prev);
    }
    expect(exitSpy).not.toHaveBeenCalled();
    const lines = stdoutText().split("\n").filter(Boolean);
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]).violations.length).toBeGreaterThan(0);
    await cleanupTmp(repo);
  });
});
