import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findViolations, main } from "../lint-comments/check.mjs";
import { cleanupTmp, commitAllIn, makeTempGitRepo } from "./test-helpers.mjs";

describe("lint-comments / findViolations", () => {
  test("clean single-line // comments produce no violations", () => {
    const src = `// top comment\nconst x = 1; // trailing\n// another\n\n// not consecutive with the previous one (blank line above)\n`;
    expect(findViolations(src)).toEqual([]);
  });

  test("two consecutive // lines flag a violation at the start of the run", () => {
    const src = `// line one\n// line two\nconst x = 1;\n`;
    const v = findViolations(src);
    expect(v.length).toBe(1);
    expect(v[0].line).toBe(1);
    expect(v[0].kind).toMatch(/2-line consecutive/);
  });

  test("three consecutive // lines report run size in the kind", () => {
    const src = `// a\n// b\n// c\nlet y = 2;\n`;
    const v = findViolations(src);
    expect(v.length).toBe(1);
    expect(v[0].kind).toMatch(/3-line consecutive/);
  });

  test("multi-line block /* ... */ flagged", () => {
    const src = `/* opening\n   middle\n   closing */\nlet z = 3;\n`;
    const v = findViolations(src);
    expect(v.length).toBe(1);
    expect(v[0].kind).toMatch(/multi-line block/);
    expect(v[0].line).toBe(1);
  });

  test("single-line block /* foo */ is allowed", () => {
    const src = `let a = 1; /* nullable */\n`;
    expect(findViolations(src)).toEqual([]);
  });

  test("doc block /** ... */ on multiple lines is exempt", () => {
    const src = `/**\n * Public API.\n */\nexport function f() {}\n`;
    expect(findViolations(src)).toEqual([]);
  });

  test("rust doc /// on multiple consecutive lines is exempt", () => {
    const src = `/// Public API.\n/// More docs.\npub fn f() {}\n`;
    expect(findViolations(src)).toEqual([]);
  });

  test("rust inner doc //! on multiple consecutive lines is exempt", () => {
    const src = `//! Crate-level docs.\n//! More.\npub fn f() {}\n`;
    expect(findViolations(src)).toEqual([]);
  });

  test("mixing // and /// is treated as separate categories (doc lines do not break the // run)", () => {
    const src = `// one\n// two\n/// three doc\n/// four doc\n`;
    const v = findViolations(src);
    expect(v.length).toBe(1);
    expect(v[0].kind).toMatch(/2-line consecutive/);
    expect(v[0].line).toBe(1);
  });

  test("// inside a string literal is not a comment", () => {
    const src = `const url = "https://example.com";\nconst other = 'a // not a comment';\n`;
    expect(findViolations(src)).toEqual([]);
  });

  test("trailing // comments after code on consecutive lines are NOT a run (each is a separate one-line comment)", () => {
    const src = `let a = 1; // first\nlet b = 2; // second\n`;
    expect(findViolations(src)).toEqual([]);
  });

  test("leading // comment followed by a trailing // on the next line does not form a run", () => {
    const src = `// leading\nlet b = 2; // trailing\n// another leading\n`;
    expect(findViolations(src)).toEqual([]);
  });

  test("blank line between // comments breaks the run", () => {
    const src = `// first\n\n// second after blank line\n`;
    expect(findViolations(src)).toEqual([]);
  });

  test("multiple violations in one file are all reported", () => {
    const src = `// a\n// b\n\n/* multi\n   block */\nlet x = 1;\n`;
    const v = findViolations(src);
    expect(v.length).toBe(2);
    expect(v[0].kind).toMatch(/2-line consecutive/);
    expect(v[1].kind).toMatch(/multi-line block/);
  });

  test("an escape sequence inside a string literal is skipped by the string scanner", () => {
    // The backslash-escaped quote must not prematurely close the string, or the
    // trailing `//` would be misread as a comment. Exercises stripStrings' \\ branch.
    const src = `const s = "a\\"// still string";\nconst t = 1;\n`;
    expect(findViolations(src)).toEqual([]);
  });

  test("a division operator (`/` not opening a comment) is not treated as a comment", () => {
    // classifyCommentOpen returns null for a bare `/`, so the scanner advances
    // past it. Two divisions on consecutive lines must not form a comment run.
    const src = `const a = 10 / 2;\nconst b = 8 / 4;\n`;
    expect(findViolations(src)).toEqual([]);
  });

  test("a single-line /* */ block after a division does not false-positive", () => {
    // A `/` division followed later by a real `/* */` block on the same line
    // drives both the null-open (division) and the block-open classify branches.
    const src = `const a = 10 / 2; /* note */\n`;
    expect(findViolations(src)).toEqual([]);
  });
});

describe("lint-comments / main", () => {
  let tmpRoot;
  let origCwd;
  let exitSpy;
  let stderrSpy;
  let stdoutSpy;
  beforeEach(async () => {
    tmpRoot = await mkdtemp(join(tmpdir(), "lc-main-"));
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

  test("--files with a clean file resolves without exit and prints nothing", async () => {
    const clean = join(tmpRoot, "clean.ts");
    await writeFile(clean, `// one-liner\nconst x = 1;\n`, "utf8");
    await main(["node", "script.mjs", "--files", clean]);
    expect(exitSpy).not.toHaveBeenCalled();
    // --files clean has no OK line (only --staged does).
    expect(stdoutText()).toBe("");
  });

  test("--files with a consecutive-comment run writes violations and exits 1", async () => {
    const bad = join(tmpRoot, "bad.ts");
    await writeFile(bad, `// a\n// b\nconst x = 1;\n`, "utf8");
    await expect(main(["node", "script.mjs", "--files", bad])).rejects.toThrow(
      /__exit__:1/,
    );
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(stderrText()).toContain("consecutive comment block");
    expect(stderrText()).toMatch(/1 violation\(s\)/);
  });

  test("--files silently skips a missing file (ENOENT swallowed) and a non-lintable path", async () => {
    const missing = join(tmpRoot, "gone.ts");
    const md = join(tmpRoot, "notes.md");
    await writeFile(md, `// a\n// b\n`, "utf8");
    await main(["node", "script.mjs", "--files", missing, md]);
    expect(exitSpy).not.toHaveBeenCalled();
  });

  test("--files rethrows a non-ENOENT read error (EISDIR on a directory)", async () => {
    // A directory path is lintable by extension but reading it throws EISDIR,
    // which lintFile must surface rather than swallow.
    const dir = join(tmpRoot, "adir.ts");
    const { mkdir } = await import("node:fs/promises");
    await mkdir(dir);
    await expect(
      main(["node", "script.mjs", "--files", dir]),
    ).rejects.toMatchObject({ code: "EISDIR" });
  });

  test("--staged over a clean repo prints the staged-diff OK line", async () => {
    const repo = await makeTempGitRepo("lc-staged-");
    await writeFile(
      join(repo, "clean.ts"),
      `// one-liner\nconst x = 1;\n`,
      "utf8",
    );
    await commitAllIn(repo, "seed");
    process.chdir(repo);
    await main(["node", "script.mjs", "--staged"]);
    expect(exitSpy).not.toHaveBeenCalled();
    expect(stdoutText()).toMatch(/no multi-line comments in staged diff/);
    await cleanupTmp(repo);
  });
});
