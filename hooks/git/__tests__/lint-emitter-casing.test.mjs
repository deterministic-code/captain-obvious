import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  findViolations,
  isEmitterFile,
  lintFile,
  main,
  scannableSource,
  FORBIDDEN,
} from "../lint-emitter-casing.mjs";
import {
  cleanupTmp,
  commitAllIn,
  makeTempGitRepo,
} from "./test-helpers.mjs";

const imp = (names) =>
  `import { ${names} } from "@deterministic-code/emitter-sdk/case";\n`;

/** An emitter-fenced path segment so `main`'s collect() actually lints the file. */
const EMITTER_REL = "scripts/codegen/lib/emit-thing.mjs";

describe("isEmitterFile", () => {
  test("emit-*.mjs and *-emit.mjs under scripts/codegen/lib are in the fence", () => {
    for (const p of [
      "scripts/codegen/lib/emit-services-typescript.mjs",
      "scripts/codegen/lib/services-emit.mjs",
      "scripts/codegen/lib/emit-service-tests-rust.mjs",
    ])
      expect(isEmitterFile(p)).toBe(true);
  });

  test("colocated __tests__, non-lib, and non-mjs files are outside the fence", () => {
    for (const p of [
      "scripts/codegen/lib/__tests__/emit-routes-rust.test.mjs",
      "scripts/codegen/build-performance-plan.mjs",
      "scripts/codegen/lib/emit-services-typescript.ts",
      "emitter-sdk/src/codegen-naming.mjs",
    ])
      expect(isEmitterFile(p)).toBe(false);
  });
});

describe("findViolations", () => {
  test("flags a forbidden helper call imported from the case module", () => {
    const src = imp("toCase") + `const x = toCase(name, "Pascal");\n`;
    const v = findViolations(src);
    expect(v).toHaveLength(1);
    expect(v[0].kind).toContain("toCase");
    expect(v[0].line).toBe(2);
  });

  test("does not flag helpers that are not imported from the case module", () => {
    const src =
      `import { toCase } from "./local-helper.mjs";\n` +
      `const x = toCase(name, "Pascal");\n`;
    expect(findViolations(src)).toHaveLength(0);
  });

  test("respects `as` aliases — flags the local name", () => {
    const src =
      imp("snakeToPascal as toPascal") + `const c = toPascal(entity);\n`;
    const v = findViolations(src);
    expect(v).toHaveLength(1);
    expect(v[0].kind).toContain("snakeToPascal");
  });

  test("ignores the import line itself and matches only call sites", () => {
    const src = imp("kebabPlural");
    expect(findViolations(src)).toHaveLength(0);
  });

  test("same-line allow directive suppresses the violation", () => {
    const src =
      imp("camelPlural") +
      `const r = \`\${camelPlural(name)}Router\`; // lint-emitter-casing-allow: camelPlural\n`;
    expect(findViolations(src)).toHaveLength(0);
  });

  test("allow directive on the line above suppresses the violation", () => {
    const src =
      imp("toCase") +
      `// lint-emitter-casing-allow: toCase\n` +
      `const s = \`\${toCase(name, "Camel")}Schema\`;\n`;
    expect(findViolations(src)).toHaveLength(0);
  });

  test("allow directive naming a different ident does not suppress", () => {
    const src =
      imp("toCase") +
      `const s = toCase(name, "Camel"); // lint-emitter-casing-allow: camelPlural\n`;
    expect(findViolations(src)).toHaveLength(1);
  });

  test("bare allow directive (no ident) suppresses any helper on that line", () => {
    const src =
      imp("toCase") +
      `const s = toCase(name, "Camel"); // lint-emitter-casing-allow:\n`;
    expect(findViolations(src)).toHaveLength(0);
  });

  test("does not match a forbidden name inside a string literal", () => {
    const src = imp("toCase") + `const s = "call toCase(x) somewhere";\n`;
    expect(findViolations(src)).toHaveLength(0);
  });

  test("detects a forbidden call inside a template interpolation", () => {
    const src =
      imp("snakeToPascal") + "const c = `${snakeToPascal(name)}Service`;\n";
    const v = findViolations(src);
    expect(v).toHaveLength(1);
    expect(v[0].kind).toContain("snakeToPascal");
  });

  test("detects a forbidden call in an interpolation nested in a route path", () => {
    const src = imp("kebabPlural") + "const p = `/api/${kebabPlural(e)}`;\n";
    expect(findViolations(src)).toHaveLength(1);
  });

  test("ignores template literal TEXT that merely mentions a helper name", () => {
    const src = imp("toCase") + "const t = `see toCase(x) in docs`;\n";
    expect(findViolations(src)).toHaveLength(0);
  });

  test("a regex literal inside an interpolation does not corrupt detection", () => {
    const src =
      imp("kebabPlural") +
      'const p = `/api/${kebabPlural(e).replace(/_/g, "-")}`;\n';
    expect(findViolations(src)).toHaveLength(1);
  });

  test("string literals inside an interpolation do not hide a sibling call", () => {
    const src =
      imp("toCase") + 'const s = `${cond ? "x" : toCase(name, "Camel")}`;\n';
    expect(findViolations(src)).toHaveLength(1);
  });

  test("every forbidden identifier is detected", () => {
    for (const id of FORBIDDEN) {
      const src = imp(id) + `const x = ${id}(name);\n`;
      expect(findViolations(src).length).toBeGreaterThan(0);
    }
  });

  test("an empty import binding entry (trailing comma) is skipped without throwing", () => {
    // The `, ` produces an empty entry that `forbiddenBindings` must `continue` past.
    const src = imp("toCase, ") + `const x = toCase(name);\n`;
    expect(findViolations(src)).toHaveLength(1);
  });

  test("an escape sequence inside a string does not open a bogus call site", () => {
    // `\\n` in the quoted literal exercises the escape-consuming path; the real
    // toCase(...) call on the next line is still flagged.
    const src =
      imp("toCase") + `const s = "line\\nbreak";\nconst y = toCase(n);\n`;
    const v = findViolations(src);
    expect(v).toHaveLength(1);
    expect(v[0].line).toBe(3);
  });

  test("a string literal spanning a raw newline is blanked and does not hide a later call", () => {
    // The unterminated-on-line-1 quote runs into a newline (quoted() returns on
    // \n); the toCase(...) that follows is still detected.
    const src = imp("toCase") + 'const s = "open\ntoCase(n)";\nconst z = toCase(n);\n';
    expect(findViolations(src).some((x) => x.kind.includes("toCase"))).toBe(true);
  });

  test("a terminated block comment mentioning a helper is ignored", () => {
    const src = imp("toCase") + `/* toCase(x) */\nconst q = toCase(n);\n`;
    const v = findViolations(src);
    expect(v).toHaveLength(1);
    expect(v[0].line).toBe(3);
  });

  test("nested braces inside a template interpolation keep depth and still flag the call", () => {
    // The `{ ... }` object literal inside the interpolation drives the depth++/--
    // bookkeeping; the toCase(...) sibling is still detected.
    const src =
      imp("toCase") + "const r = `${ (() => { return toCase(n); })() }`;\n";
    expect(findViolations(src).some((x) => x.kind.includes("toCase"))).toBe(true);
  });
});

describe("scannableSource (Scanner branches)", () => {
  test("keeps interpolation code but blanks the surrounding template text", () => {
    const out = scannableSource("`abc${x}def`");
    expect(out).toContain("${x}");
    expect(out).not.toContain("abc");
    expect(out).not.toContain("def");
  });

  test("blanks a line comment while preserving offsets and the newline", () => {
    const src = "a // note\nb\n";
    const out = scannableSource(src);
    expect(out.length).toBe(src.length);
    expect(out).not.toContain("note");
    expect(out.split("\n").length).toBe(src.split("\n").length);
  });

  test("blanks a block comment that spans a newline, preserving that newline", () => {
    const src = "a /* one\ntwo */ b";
    const out = scannableSource(src);
    expect(out.length).toBe(src.length);
    expect(out).not.toContain("one");
    expect(out).not.toContain("two");
    expect(out).toContain("\n");
  });

  test("an escape inside a quoted string consumes two chars as blanks", () => {
    const src = '"a\\nb"';
    const out = scannableSource(src);
    expect(out.length).toBe(src.length);
    expect(out.startsWith('"')).toBe(true);
    expect(out.endsWith('"')).toBe(true);
  });

  test("a quoted string running into a raw newline is blanked at the newline", () => {
    const src = '"open\nx';
    const out = scannableSource(src);
    expect(out.length).toBe(src.length);
    expect(out).toContain("\n");
    expect(out).not.toContain("open");
  });

  test("a regex literal with a character class is blanked (class brackets tracked)", () => {
    // `/` after `=` is a regex; the `[/]` class contains a slash that must NOT
    // end the literal early, and the trailing flags are kept.
    const src = "const re = /[a-z/]+/g;";
    const out = scannableSource(src);
    expect(out.length).toBe(src.length);
    expect(out).toContain("/");
    expect(out).toContain("g");
    expect(out).not.toContain("a-z");
  });

  test("an escape inside a regex literal consumes two chars", () => {
    const src = "const re = /a\\/b/;";
    const out = scannableSource(src);
    expect(out.length).toBe(src.length);
  });

  test("lastKept returns empty when nothing but whitespace precedes a slash", () => {
    // Leading `/.../ ` — REGEX_PREV includes "" so a leading regex is recognized.
    const src = "  /ab/;";
    const out = scannableSource(src);
    expect(out.length).toBe(src.length);
    expect(out).not.toContain("ab");
  });

  test("an escape inside a template body consumes two chars", () => {
    const src = "`a\\`b`";
    const out = scannableSource(src);
    expect(out.length).toBe(src.length);
  });
});

describe("main / runner", () => {
  let tmpRoot;
  let origCwd;
  let exitSpy;
  let stderrSpy;
  let stdoutSpy;
  beforeEach(async () => {
    tmpRoot = await mkdtemp(join(tmpdir(), "lec-emit-"));
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

  const writeEmitter = async (repo, body) => {
    await mkdir(join(repo, "scripts/codegen/lib"), { recursive: true });
    await writeFile(join(repo, EMITTER_REL), body, "utf8");
    return EMITTER_REL;
  };

  test("unknown mode prints usage and exits 2", async () => {
    await expect(main(["node", "s.mjs", "--bogus"])).rejects.toThrow(
      /__exit__:2/,
    );
    expect(stderrText()).toMatch(/Usage:/);
  });

  test("--files on a clean emitter resolves without exit", async () => {
    const repo = await makeTempGitRepo("lec-emit-clean-");
    const rel = await writeEmitter(
      repo,
      imp("toCase") + "export const x = 1;\n",
    );
    process.chdir(repo);
    await main(["node", "s.mjs", "--files", join(repo, rel)]);
    expect(exitSpy).not.toHaveBeenCalled();
    await cleanupTmp(repo);
  });

  test("--files on a dirty emitter writes the violation and exits 1", async () => {
    const repo = await makeTempGitRepo("lec-emit-dirty-");
    const rel = await writeEmitter(
      repo,
      imp("toCase") + "const y = toCase(n);\n",
    );
    process.chdir(repo);
    await expect(
      main(["node", "s.mjs", "--files", join(repo, rel)]),
    ).rejects.toThrow(/__exit__:1/);
    expect(stderrText()).toMatch(/hardcoded casing helper/);
    await cleanupTmp(repo);
  });

  test("--files skips non-emitter paths (collect returns [])", async () => {
    const repo = await makeTempGitRepo("lec-emit-skip-");
    const p = join(repo, "not-an-emitter.mjs");
    await writeFile(p, imp("toCase") + "const y = toCase(n);\n", "utf8");
    process.chdir(repo);
    await main(["node", "s.mjs", "--files", p]);
    expect(exitSpy).not.toHaveBeenCalled();
    await cleanupTmp(repo);
  });

  test("--staged clean repo prints the staged-diff OK line", async () => {
    const repo = await makeTempGitRepo("lec-emit-staged-");
    await writeEmitter(repo, imp("toCase") + "export const x = 1;\n");
    await commitAllIn(repo, "seed");
    process.chdir(repo);
    await main(["node", "s.mjs", "--staged"]);
    expect(exitSpy).not.toHaveBeenCalled();
    expect(stdoutText()).toMatch(/no hardcoded casing helpers in emitters/);
    await cleanupTmp(repo);
  });

  test("--all dirty repo flags the violation and exits 1", async () => {
    const repo = await makeTempGitRepo("lec-emit-all-");
    await writeEmitter(repo, imp("toCase") + "const y = toCase(n);\n");
    await commitAllIn(repo, "seed");
    process.chdir(repo);
    await expect(main(["node", "s.mjs", "--all"])).rejects.toThrow(
      /__exit__:1/,
    );
    expect(stderrText()).toMatch(/hardcoded casing helper/);
    await cleanupTmp(repo);
  });

  test("--warn downgrades a violation to advisory (no exit)", async () => {
    const repo = await makeTempGitRepo("lec-emit-warn-");
    const rel = await writeEmitter(
      repo,
      imp("toCase") + "const y = toCase(n);\n",
    );
    process.chdir(repo);
    await main(["node", "s.mjs", "--files", join(repo, rel), "--warn"]);
    expect(exitSpy).not.toHaveBeenCalled();
    expect(stderrText()).toMatch(/advisory — not blocking/);
    await cleanupTmp(repo);
  });
});

describe("lintFile", () => {
  let tmpRoot;
  beforeEach(async () => {
    tmpRoot = await mkdtemp(join(tmpdir(), "lec-emit-file-"));
  });
  afterEach(async () => {
    await cleanupTmp(tmpRoot);
  });

  test("tags a violation with the given path", async () => {
    const p = join(tmpRoot, "emit-x.mjs");
    await writeFile(p, imp("toCase") + "const y = toCase(n);\n", "utf8");
    const v = await lintFile(p);
    expect(v).toHaveLength(1);
    expect(v[0].path).toBe(p);
  });
});
