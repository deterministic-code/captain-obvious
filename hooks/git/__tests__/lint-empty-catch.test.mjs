import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  findViolations,
  formatViolation,
  isExcluded,
  isLintable,
  lintFile,
  main,
  stripStringsAndComments,
  SUPPORTED_EXTS,
  EXCLUDED_PATH_PARTS,
} from "../lint-empty-catch.mjs";
import { cleanupTmp } from "./test-helpers.mjs";

describe("findViolations", () => {
  test("empty src returns no violations", () => {
    expect(findViolations("")).toEqual([]);
  });

  test("source without any catch block returns no violations", () => {
    expect(findViolations("function foo() { return 1; }")).toEqual([]);
  });

  test("single empty catch `} catch {}` flags one violation", () => {
    const src = `try { f(); } catch {}\n`;
    const v = findViolations(src);
    expect(v.length).toBe(1);
    expect(v[0].kind).toBe("empty catch block");
    expect(v[0].line).toBe(1);
    expect(v[0].col).toBeGreaterThan(0);
  });

  test("empty catch with arg `} catch (e) {}` flags one violation", () => {
    const src = `try { f(); } catch (e) {}\n`;
    const v = findViolations(src);
    expect(v.length).toBe(1);
    expect(v[0].kind).toBe("empty catch block");
  });

  test("catch body containing only whitespace and newlines is empty", () => {
    const src = `try { f(); } catch {\n   \n }\n`;
    const v = findViolations(src);
    expect(v.length).toBe(1);
    expect(v[0].kind).toBe("empty catch block");
  });

  test("catch body containing only a block comment is empty", () => {
    const src = `try { f(); } catch { /* ignore */ }\n`;
    const v = findViolations(src);
    expect(v.length).toBe(1);
    expect(v[0].kind).toBe("empty catch block");
  });

  test("catch body containing only a `// best-effort` line comment is empty", () => {
    const src = `try { f(); } catch {\n  // best-effort\n}\n`;
    const v = findViolations(src);
    expect(v.length).toBe(1);
    expect(v[0].kind).toBe("empty catch block");
  });

  test("non-empty catch with a real statement produces no violation", () => {
    const src = `try { f(); } catch (e) { console.log(e); }\n`;
    expect(findViolations(src)).toEqual([]);
  });

  test("catch body with nested braces and a statement is non-empty", () => {
    const src = `try { f(); } catch (e) { if (x) { y(); } }\n`;
    expect(findViolations(src)).toEqual([]);
  });

  test("multiple catches: two empty + one non-empty flag exactly two", () => {
    const src = [
      `try { a(); } catch {}`,
      `try { b(); } catch (e) { handle(e); }`,
      `try { c(); } catch (e) {}`,
      ``,
    ].join("\n");
    const v = findViolations(src);
    expect(v.length).toBe(2);
    expect(v[0].line).toBe(1);
    expect(v[1].line).toBe(3);
  });

  test("catch keyword inside a double-quoted string literal is ignored", () => {
    const src = `const s = "} catch {}";\n`;
    expect(findViolations(src)).toEqual([]);
  });

  test("catch keyword inside a // line comment is ignored", () => {
    const src = `// } catch {}\nconst x = 1;\n`;
    expect(findViolations(src)).toEqual([]);
  });

  test("catch keyword inside a backtick template string is ignored", () => {
    const src = "const s = `catch {}`;\n";
    expect(findViolations(src)).toEqual([]);
  });

  test("identifier with `catch` as a substring (no word boundary) does not match", () => {
    const src = `function precatch() {}\n`;
    expect(findViolations(src)).toEqual([]);
  });
});

describe("stripStringsAndComments", () => {
  test("// line comment is replaced with spaces while preserving the newline", () => {
    const src = `let a = 1; // tail comment\nlet b = 2;\n`;
    const out = stripStringsAndComments(src);
    expect(out.length).toBe(src.length);
    expect(out).not.toContain("tail");
    expect(out.split("\n").length).toBe(src.split("\n").length);
  });

  test("/* multi line */ block is replaced with spaces, line breaks preserved", () => {
    const src = `let a = 1; /* line one\n line two */ let b = 2;\n`;
    const out = stripStringsAndComments(src);
    expect(out.length).toBe(src.length);
    expect(out).not.toContain("line one");
    expect(out).not.toContain("line two");
    expect(out.split("\n").length).toBe(src.split("\n").length);
  });

  test("double-quoted string contents are blanked but the quotes remain", () => {
    const src = `const s = "secret";\n`;
    const out = stripStringsAndComments(src);
    expect(out.length).toBe(src.length);
    expect(out).not.toContain("secret");
    expect(out).toContain('"');
  });

  test("backtick template string contents are blanked", () => {
    const src = "const s = `hidden`;\n";
    const out = stripStringsAndComments(src);
    expect(out.length).toBe(src.length);
    expect(out).not.toContain("hidden");
    expect(out).toContain("`");
  });

  test("escape sequence inside a string consumes two characters as spaces", () => {
    const src = `"\\n"`;
    const out = stripStringsAndComments(src);
    expect(out.length).toBe(src.length);
    expect(out.startsWith('"')).toBe(true);
    expect(out.endsWith('"')).toBe(true);
  });

  test("output length always equals input length (offset-preserving)", () => {
    const src = [
      `// a comment line`,
      `const s1 = "hello \\"world\\"";`,
      `/* block`,
      `   spans */`,
      "const s2 = `template ${x}`;",
      ``,
    ].join("\n");
    const out = stripStringsAndComments(src);
    expect(out.length).toBe(src.length);
  });
});

describe("isExcluded and isLintable", () => {
  test("isExcluded returns true for a node_modules path", () => {
    expect(isExcluded("node_modules/foo.ts")).toBe(true);
  });

  test("isExcluded normalizes a leading ./ before checking", () => {
    expect(isExcluded("./node_modules/foo.ts")).toBe(true);
  });

  test("isExcluded returns false for a normal source path", () => {
    expect(isExcluded("src/foo.ts")).toBe(false);
  });

  test("isLintable returns true for a .ts source path", () => {
    expect(isLintable("src/foo.ts")).toBe(true);
  });

  test("isLintable returns false for an unsupported extension (.md)", () => {
    expect(isLintable("src/foo.md")).toBe(false);
  });

  test("isLintable returns false when the path is excluded even if extname is supported", () => {
    expect(isLintable("node_modules/foo.ts")).toBe(false);
  });

  test("SUPPORTED_EXTS is the JS/TS family only", () => {
    for (const ext of [".ts", ".tsx", ".mjs", ".cjs", ".js", ".jsx"]) {
      expect(SUPPORTED_EXTS.has(ext)).toBe(true);
    }
  });

  test("SUPPORTED_EXTS excludes Rust and C#", () => {
    for (const ext of [".rs", ".cs"]) {
      expect(SUPPORTED_EXTS.has(ext)).toBe(false);
    }
  });

  test("EXCLUDED_PATH_PARTS contains the documented set", () => {
    expect(EXCLUDED_PATH_PARTS).toContain("/node_modules/");
    expect(EXCLUDED_PATH_PARTS).toContain("/dist/");
    expect(EXCLUDED_PATH_PARTS).toContain("/samples/demo-backend/");
  });
});

describe("lintFile", () => {
  let tmpRoot;
  beforeEach(async () => {
    tmpRoot = await mkdtemp(join(tmpdir(), "lec-test-"));
  });
  afterEach(async () => {
    await cleanupTmp(tmpRoot);
  });

  test("returns one violation with `.path` set when the file has an empty catch", async () => {
    const p = join(tmpRoot, "bad.ts");
    await writeFile(p, `try { f(); } catch {}\n`, "utf8");
    const violations = await lintFile(p);
    expect(violations.length).toBe(1);
    expect(violations[0].path).toBe(p);
    expect(violations[0].kind).toBe("empty catch block");
  });

  test("returns [] for a path that does not exist (ENOENT swallowed)", async () => {
    const p = join(tmpRoot, "does-not-exist.ts");
    const violations = await lintFile(p);
    expect(violations).toEqual([]);
  });
});

describe("formatViolation", () => {
  test("format string is `path:line:col  kind` followed by `\\n    detail`", () => {
    const out = formatViolation({
      path: "src/foo.ts",
      line: 7,
      col: 3,
      kind: "empty catch block",
      detail: "explanatory detail",
    });
    expect(out).toBe(
      "src/foo.ts:7:3  empty catch block\n    explanatory detail",
    );
  });
});

describe("main", () => {
  let tmpRoot;
  let exitSpy;
  let stderrSpy;
  let stdoutSpy;
  beforeEach(async () => {
    tmpRoot = await mkdtemp(join(tmpdir(), "lec-main-"));
    exitSpy = vi.spyOn(process, "exit").mockImplementation((code) => {
      throw new Error(`__exit__:${code}`);
    });
    stderrSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    stdoutSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);
  });
  afterEach(async () => {
    exitSpy.mockRestore();
    stderrSpy.mockRestore();
    stdoutSpy.mockRestore();
    await cleanupTmp(tmpRoot);
  });

  test("empty argv prints usage to stderr and exits with code 2", async () => {
    await expect(main(["node", "script.mjs"])).rejects.toThrow(/__exit__:2/);
    expect(exitSpy).toHaveBeenCalledWith(2);
    const usageWritten = stderrSpy.mock.calls.map((c) => c[0]).join("");
    expect(usageWritten).toMatch(/Usage:/);
  });

  test("--files with a clean .ts file resolves without calling process.exit", async () => {
    const clean = join(tmpRoot, "clean.ts");
    await writeFile(
      clean,
      `try { f(); } catch (e) { console.log(e); }\n`,
      "utf8",
    );
    await main(["node", "script.mjs", "--files", clean]);
    expect(exitSpy).not.toHaveBeenCalled();
    const stdoutWritten = stdoutSpy.mock.calls.map((c) => c[0]).join("");
    expect(stdoutWritten).not.toMatch(/staged diff/);
    expect(stdoutWritten).not.toMatch(/in repo/);
  });

  test("--files with an empty-catch file writes violation to stderr and exits 1", async () => {
    const bad = join(tmpRoot, "bad.ts");
    await writeFile(bad, `try { f(); } catch {}\n`, "utf8");
    await expect(main(["node", "script.mjs", "--files", bad])).rejects.toThrow(
      /__exit__:1/,
    );
    expect(exitSpy).toHaveBeenCalledWith(1);
    const stderrWritten = stderrSpy.mock.calls.map((c) => c[0]).join("");
    expect(stderrWritten).toContain(bad);
    expect(stderrWritten).toContain("empty catch block");
    expect(stderrWritten).toMatch(/1 violation\(s\)/);
  });

  test("--files filters out non-lintable paths (.md ignored even with empty catch text)", async () => {
    const md = join(tmpRoot, "notes.md");
    await writeFile(md, `try { f(); } catch {}\n`, "utf8");
    await main(["node", "script.mjs", "--files", md]);
    expect(exitSpy).not.toHaveBeenCalled();
  });
});
