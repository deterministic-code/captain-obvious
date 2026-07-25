import { describe, expect, test } from "vitest";
import { findViolations } from "../lint-comments.mjs";

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
});
