import { describe, expect, test } from "vitest";
import {
  cloneClusters,
  tableViolations,
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

  test("a two-entry table is NOT flagged (needs at least three siblings)", () => {
    const src = `export const CONV = {
  typescript: { prunePattern: /^[A-Za-z]+\\.ts$/ },
  rust: { prunePattern: /^[A-Za-z_]+\\.rs$/ },
};`;
    expect(violations(src)).toHaveLength(0);
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
