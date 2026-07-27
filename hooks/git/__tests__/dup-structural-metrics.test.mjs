import { chmod, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  cloneClusters,
  subtreesForFile,
  tableViolations,
  tableViolationsForFile,
} from "../dup-structural-metrics.mjs";
import { parseSourceFile } from "../fn-metrics.mjs";

function violations(src) {
  return tableViolations("f.mjs", parseSourceFile("f.mjs", src));
}

describe("tableViolations — Detector A sibling symmetry", () => {
  test("three siblings sharing an identical regex column yield one structural violation", () => {
    const src = `export const CONV = {
  typescript: { prunePattern: /^[A-Za-z]+\\.ts$/, ext: ".ts" },
  rust: { prunePattern: /^[A-Za-z_]+\\.rs$/, ext: ".rs" },
  python: { prunePattern: /^[A-Za-z_]+\\.py$/, ext: ".py" },
};`;
    const found = violations(src);
    expect(found).toHaveLength(1);
    expect(found[0].kind).toContain("structural sibling duplication");
    expect(found[0].detail).toContain("prunePattern");
    expect(found[0].detail).toContain("collapse to a data table + factory");
  });

  test("a table whose only repeated column is a plain data literal is NOT flagged", () => {
    const src = `export const LABELS = {
  a: { label: "a" },
  b: { label: "b" },
  c: { label: "c" },
};`;
    expect(violations(src)).toHaveLength(0);
  });

  // Three object rows, but each has a distinct key-set, so the largest matching
  // group is under MIN_SIBLINGS and the table is not collapsible.
  test("three rows with no shared key-set (largest group < 3) is NOT flagged", () => {
    const src = `export const CONV = {
  a: { p: /^x$/ },
  b: { p: /^y$/, q: /^z$/ },
  c: { r: /^w$/, s: /^v$/, t: /^u$/ },
};`;
    expect(violations(src)).toHaveLength(0);
  });

  test("a two-entry table is NOT flagged (needs at least three siblings)", () => {
    const src = `export const CONV = {
  typescript: { prunePattern: /^[A-Za-z]+\\.ts$/ },
  rust: { prunePattern: /^[A-Za-z_]+\\.rs$/ },
};`;
    expect(violations(src)).toHaveLength(0);
  });

  // Non-property-assignment entries (a spread) and non-object-literal values (a
  // bare string) are skipped, so only the three regex-valued rows count.
  test("skips spread and non-object-literal entries while still flagging the object rows", () => {
    const src = `const base = { prunePattern: /^x$/ };
export const CONV = {
  ...base,
  version: "1.0.0",
  typescript: { prunePattern: /^[A-Za-z]+\\.ts$/ },
  rust: { prunePattern: /^[A-Za-z_]+\\.rs$/ },
  python: { prunePattern: /^[A-Za-z_]+\\.py$/ },
};`;
    const found = violations(src);
    expect(found).toHaveLength(1);
    expect(found[0].detail).toContain("prunePattern");
  });

  test("SERVICE_TEST_CONVENTIONS-shaped input reports regex column mechanical, differing arrow bodies load-bearing", () => {
    const src = `export const SERVICE_TEST_CONVENTIONS = {
  typescript: {
    prunePattern: /^[A-Za-z]+Service\\.test\\.ts$/,
    customTestFileName: (kebab) => \`\${kebab}.test.ts\`,
  },
  csharp: {
    prunePattern: /^[A-Za-z]+ServiceTests\\.cs$/,
    customTestFileName: (kebab) => \`\${toCase(kebab, "Pascal")}Tests.cs\`,
  },
  rust: {
    prunePattern: /^[A-Za-z_]+_service_test\\.rs$/,
    customTestFileName: (kebab) => \`\${toCase(kebab, "Snake")}_test.rs\`,
  },
};`;
    const found = violations(src);
    expect(found).toHaveLength(1);
    const { detail } = found[0];
    const mechanicalIdx = detail.indexOf("prunePattern");
    const keepIdx = detail.indexOf("Load-bearing");
    expect(mechanicalIdx).toBeGreaterThan(-1);
    expect(keepIdx).toBeGreaterThan(-1);
    expect(detail).toContain("customTestFileName");
    expect(detail.indexOf("customTestFileName")).toBeGreaterThan(keepIdx);
  });
});

describe("cloneClusters — Detector B", () => {
  test("two files sharing one identical above-floor fingerprint form a cluster of two; sub-floor fps excluded", () => {
    const sharedFp = "(ObjectLiteralExpression big)";
    const subtreesByFile = [
      {
        path: "a.mjs",
        subtrees: [
          { fp: sharedFp, start: 1, end: 5, nodeCount: 25 },
          { fp: "(ObjectLiteralExpression tiny)", start: 7, end: 8, nodeCount: 4 },
        ],
      },
      {
        path: "b.mjs",
        subtrees: [
          { fp: sharedFp, start: 10, end: 14, nodeCount: 25 },
          { fp: "(ObjectLiteralExpression tiny)", start: 20, end: 21, nodeCount: 4 },
        ],
      },
    ];
    const clusters = cloneClusters(subtreesByFile, { minNodes: 20 });
    expect(clusters).toHaveLength(1);
    expect(clusters[0]).toHaveLength(2);
    expect(clusters[0].map((c) => c.path).sort()).toEqual(["a.mjs", "b.mjs"]);
  });
});

describe("tableViolationsForFile + subtreesForFile — file I/O", () => {
  let dir;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "dup-structural-io-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const TABLE = `export const CONV = {
  typescript: { prunePattern: /^[A-Za-z]+\\.ts$/, ext: ".ts" },
  rust: { prunePattern: /^[A-Za-z_]+\\.rs$/, ext: ".rs" },
  python: { prunePattern: /^[A-Za-z_]+\\.py$/, ext: ".py" },
};`;

  test("tableViolationsForFile parses a real file and reports the sibling table", async () => {
    const path = join(dir, "conv.mjs");
    await writeFile(path, TABLE);
    const found = await tableViolationsForFile(path);
    expect(found).toHaveLength(1);
    expect(found[0].path).toBe(path);
    expect(found[0].detail).toContain("prunePattern");
  });

  test("tableViolationsForFile returns [] for a missing file (ENOENT → null)", async () => {
    expect(await tableViolationsForFile(join(dir, "nope.mjs"))).toEqual([]);
  });

  test("subtreesForFile returns collected subtrees for a real file", async () => {
    const path = join(dir, "conv.mjs");
    await writeFile(path, TABLE);
    const { subtrees } = await subtreesForFile(path);
    expect(subtrees.length).toBeGreaterThan(0);
    expect(subtrees[0].kind).toBe("ObjectLiteralExpression");
  });

  test("subtreesForFile yields an empty subtree set for a directory (EISDIR → null)", async () => {
    const sub = join(dir, "adir");
    await mkdir(sub);
    expect(await subtreesForFile(sub)).toEqual({ path: sub, subtrees: [] });
  });

  // A read error that is neither ENOENT nor EISDIR (here EACCES) is rethrown, not
  // swallowed — malformed reads must surface, not be treated as "no violations".
  test("tableViolationsForFile rethrows a non-ENOENT/EISDIR read error (EACCES)", async () => {
    const path = join(dir, "locked.mjs");
    await writeFile(path, TABLE);
    await chmod(path, 0o000);
    try {
      await expect(tableViolationsForFile(path)).rejects.toThrow(/EACCES/);
    } finally {
      await chmod(path, 0o644);
    }
  });
});
