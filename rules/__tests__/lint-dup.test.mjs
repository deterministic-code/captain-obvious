import { join } from "node:path";
import { describe, expect, test } from "vitest";
import {
  JS_TS_FORMAT_FAMILY,
  JSCPD_FORMAT_BY_EXT,
  formatsFor,
  isImportOnlyFragment,
  jscpdIgnoreGlobs,
  parseJscpdReport,
  selectNewClones,
} from "../lint-dup/check.mjs";

describe("lint-dup / formatsFor", () => {
  test("expands a lone .tsx changeset to the whole JS/TS family (jscpd crashes on a singleton tsx scan)", () => {
    expect(formatsFor(["src/Sidebar.tsx"]).sort()).toEqual(
      [...JS_TS_FORMAT_FAMILY].sort(),
    );
  });

  test("expands whenever any JS/TS-family member is present", () => {
    expect(formatsFor(["a.ts"]).sort()).toEqual(
      [...JS_TS_FORMAT_FAMILY].sort(),
    );
    expect(formatsFor(["a.jsx"]).sort()).toEqual(
      [...JS_TS_FORMAT_FAMILY].sort(),
    );
  });

  test("returns an empty set when no code files are given", () => {
    expect(formatsFor(["README.md", "data.yaml"])).toEqual([]);
  });
});

describe("lint-dup / parseJscpdReport", () => {
  test("returns the duplicates array when present", () => {
    const dup = { lines: 6, firstFile: {}, secondFile: {} };
    const json = JSON.stringify({ duplicates: [dup] });
    expect(parseJscpdReport(json)).toEqual([dup]);
  });

  test("throws an invariant error when no duplicates array is present", () => {
    expect(() => parseJscpdReport("{}")).toThrow(/invariant/);
  });
});

describe("lint-dup / selectNewClones", () => {
  const repoRoot = "/repo";

  function clone(first, second, lines = 6) {
    return {
      lines,
      firstFile: { name: first.name, start: first.start, end: first.end },
      secondFile: { name: second.name, start: second.start, end: second.end },
    };
  }

  function abDuplicates() {
    return [
      clone(
        { name: "a.ts", start: 10, end: 15 },
        { name: "b.ts", start: 40, end: 45 },
      ),
    ];
  }

  test("firstFile in the map and overlapping added lines yields one violation", async () => {
    const duplicates = abDuplicates();
    const added = new Map([["a.ts", [[12, 20]]]]);
    const violations = await selectNewClones(duplicates, added, repoRoot);
    expect(violations.length).toBe(1);
    expect(violations[0].path).toBe("a.ts");
    expect(violations[0].line).toBe(10);
    expect(violations[0].detail).toContain("b.ts:40-45");
  });

  test("changed side that does not overlap added ranges yields no violation", async () => {
    const duplicates = abDuplicates();
    const added = new Map([["a.ts", [[100, 120]]]]);
    expect(await selectNewClones(duplicates, added, repoRoot)).toEqual([]);
  });

  test("clone with neither side in the map yields no violation", async () => {
    const duplicates = abDuplicates();
    const added = new Map([["c.ts", [[1, 50]]]]);
    expect(await selectNewClones(duplicates, added, repoRoot)).toEqual([]);
  });

  test("absolute-path clone names normalize to repo-relative for the map lookup", async () => {
    const absFirst = join(repoRoot, "src", "a.ts");
    const duplicates = [
      clone(
        { name: absFirst, start: 10, end: 15 },
        { name: "src/b.ts", start: 40, end: 45 },
      ),
    ];
    const added = new Map([[join("src", "a.ts"), [[12, 20]]]]);
    const violations = await selectNewClones(duplicates, added, repoRoot);
    expect(violations.length).toBe(1);
    expect(violations[0].path).toBe(join("src", "a.ts"));
    expect(violations[0].detail).toContain("src/b.ts:40-45");
  });
});

describe("lint-dup / isImportOnlyFragment", () => {
  test("single-line imports are import-only", () => {
    expect(
      isImportOnlyFragment('import { a } from "x";\nimport b from "y";'),
    ).toBe(true);
  });

  test("a multi-line import is import-only", () => {
    expect(isImportOnlyFragment('import {\n  a,\n  b,\n} from "x";')).toBe(
      true,
    );
  });

  test("a block with any non-import line is not import-only", () => {
    expect(isImportOnlyFragment('import a from "x";\nconst y = 1;')).toBe(
      false,
    );
  });

  test("a clone beginning inside a multi-line import is import-only", () => {
    expect(
      isImportOnlyFragment('  b,\n  c,\n} from "x";\nimport { d } from "y";'),
    ).toBe(true);
  });

  test("a bare identifier list with no import boundary is NOT import-only", () => {
    expect(isImportOnlyFragment("foo,\nbar,\nbaz,")).toBe(false);
  });

  test("an empty fragment is not import-only", () => {
    expect(isImportOnlyFragment("")).toBe(false);
  });

  test("a non-string fragment is not import-only", () => {
    expect(isImportOnlyFragment(null)).toBe(false);
    expect(isImportOnlyFragment(undefined)).toBe(false);
  });

  // A closer line `} from "x";` as the very FIRST line (never inImport) matches
  // IMPORT_MEMBER_RE and, because it carries `from`, sets sawImport directly.
  test("a lone `} from \"x\";` closer is import-only via the member+from branch", () => {
    expect(isImportOnlyFragment('} from "x";')).toBe(true);
  });

  test("comment-only and blank lines are stripped before the import scan", () => {
    expect(
      isImportOnlyFragment('// leading note\n\nimport { a } from "x";'),
    ).toBe(true);
  });
});

describe("lint-dup / jscpdIgnoreGlobs", () => {
  test("includes the shared excluded parts and generated globs with no duplicates", () => {
    const globs = jscpdIgnoreGlobs();
    expect(globs).toContain("**/node_modules/**");
    expect(globs).toContain("**/.worktrees/**");
    expect(globs).toContain("**/generated/**");
    expect(globs).toContain("**/samples/**");
    expect(new Set(globs).size).toBe(globs.length);
  });
});

describe("lint-dup / JSCPD_FORMAT_BY_EXT", () => {
  test("maps JS/TS extensions to jscpd format names", () => {
    expect(JSCPD_FORMAT_BY_EXT[".ts"]).toBe("typescript");
    expect(JSCPD_FORMAT_BY_EXT[".mjs"]).toBe("javascript");
  });

  test("does not map Rust or C# (out of scope for the Node hooks)", () => {
    expect(JSCPD_FORMAT_BY_EXT[".rs"]).toBeUndefined();
    expect(JSCPD_FORMAT_BY_EXT[".cs"]).toBeUndefined();
  });
});
