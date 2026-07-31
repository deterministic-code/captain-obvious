import { describe, test, expect } from "vitest";
import { parseSourceFile } from "../_kit/fn-metrics.mjs";
import { collectSubtrees } from "../_kit/ast-fingerprint.mjs";
import {
  FN_MIN_NODES,
  functionClones,
  clusterTier,
  clusterViolation,
} from "../_kit/dup-fn-metrics.mjs";

function subtrees(path, src) {
  return {
    path,
    subtrees: collectSubtrees(parseSourceFile(path, src), {
      minNodes: FN_MIN_NODES,
    }),
  };
}

const CAMEL_TO_SNAKE = `function camelToSnake(name) {
  return name.replace(/([a-z0-9])([A-Z])/g, "$1_$2").replace(/x/g, "y").toLowerCase();
}`;

const PASCAL_OR_CAMEL = `function pascalOrCamelToSnake(input) {
  return input.replace(/([a-z0-9])([A-Z])/g, "$1_$2").replace(/z/g, "w").toLowerCase();
}`;

const DIFFERENT = `function upcase(name) {
  const out = [];
  for (const ch of name) { out.push(ch.toUpperCase()); }
  return out.join("");
}`;

describe("functionClones", () => {
  test("same body under different names across files → one cluster", () => {
    const clusters = functionClones([
      subtrees("a.mjs", CAMEL_TO_SNAKE),
      subtrees("b.mjs", PASCAL_OR_CAMEL),
    ]);
    expect(clusters).toHaveLength(1);
    expect(new Set(clusters[0].map((m) => m.name))).toEqual(
      new Set(["camelToSnake", "pascalOrCamelToSnake"]),
    );
  });

  test("genuinely different bodies → no cluster", () => {
    const clusters = functionClones([
      subtrees("a.mjs", CAMEL_TO_SNAKE),
      subtrees("b.mjs", DIFFERENT),
    ]);
    expect(clusters).toHaveLength(0);
  });

  test("anonymous inline callbacks are ignored (a reinvented helper has a name)", () => {
    const anon = `export function alpha(items) {
      return items.map((n) => { const doubled = n * 2; const squared = n * n; return doubled + squared; });
    }`;
    const anon2 = `export function beta(list) {
      return list.filter(Boolean).flatMap((n) => { const doubled = n * 2; const squared = n * n; return doubled + squared; });
    }`;
    const clusters = functionClones([
      subtrees("a.mjs", anon),
      subtrees("b.mjs", anon2),
    ]);
    expect(clusters).toHaveLength(0);
  });

  test("a single definition (one site) is not a clone", () => {
    const clusters = functionClones([subtrees("a.mjs", CAMEL_TO_SNAKE)]);
    expect(clusters).toHaveLength(0);
  });

  test("trivial bodies under the node threshold do not cluster", () => {
    const tiny = `function schemaIdentA(n) { return n + "Schema"; }`;
    const tiny2 = `function schemaIdentB(m) { return m + "Schema"; }`;
    const clusters = functionClones([
      subtrees("a.mjs", tiny),
      subtrees("b.mjs", tiny2),
    ]);
    expect(clusters).toHaveLength(0);
  });
});

describe("clusterTier + clusterViolation", () => {
  test("a cluster straddling emitter-sdk/ is tier 'canonical'", () => {
    const clusters = functionClones([
      subtrees("emitter-sdk/src/case.mjs", CAMEL_TO_SNAKE),
      subtrees("scripts/lib/thing.mjs", PASCAL_OR_CAMEL),
    ]);
    expect(clusters).toHaveLength(1);
    expect(clusterTier(clusters[0])).toBe("canonical");
    const v = clusterViolation(clusters[0], "/repo");
    expect(v.kind).toContain("canonical");
    expect(v.detail).toContain("emitter-sdk");
    expect(v.path).toBe("scripts/lib/thing.mjs");
  });

  test("twins in different non-SDK files are tier 'cross-file'", () => {
    const clusters = functionClones([
      subtrees("scripts/a.mjs", CAMEL_TO_SNAKE),
      subtrees("scripts/b.mjs", PASCAL_OR_CAMEL),
    ]);
    expect(clusterTier(clusters[0])).toBe("cross-file");
  });

  // Two differently-named twins in ONE file: the files>1 test fails, so the
  // names>1 disjunct is what keeps the cluster, and the tier is same-file.
  test("two differently-named twins in the same file are tier 'same-file'", () => {
    const bothInOne = `${CAMEL_TO_SNAKE}\n${PASCAL_OR_CAMEL}`;
    const clusters = functionClones([subtrees("scripts/a.mjs", bothInOne)]);
    expect(clusters).toHaveLength(1);
    expect(clusterTier(clusters[0])).toBe("same-file");
    const v = clusterViolation(clusters[0], "/repo");
    expect(v.kind).toContain("same-file");
    expect(v.detail).toContain("collapse to one");
  });

  // clusterViolation with no explicit primary anchors on the first non-canonical
  // site and normalizes absolute member paths to repo-relative in the sites list.
  test("absolute member paths are rendered repo-relative in the sites list", () => {
    const clusters = functionClones([
      subtrees("/repo/scripts/a.mjs", CAMEL_TO_SNAKE),
      subtrees("/repo/scripts/b.mjs", PASCAL_OR_CAMEL),
    ]);
    const v = clusterViolation(clusters[0], "/repo");
    expect(v.path).toBe("scripts/a.mjs");
    expect(v.detail).toContain("scripts/a.mjs:");
    expect(v.detail).toContain("scripts/b.mjs:");
    expect(v.detail).not.toContain("/repo/scripts");
  });

  // An explicit primary (the diff-hit member in ratchet mode) overrides the
  // non-canonical/first-site anchor fallback.
  test("an explicit primary anchors the violation", () => {
    const cluster = [
      { path: "/repo/x.mjs", name: "one", start: 3, end: 9, nodeCount: 20 },
      { path: "/repo/y.mjs", name: "two", start: 4, end: 10, nodeCount: 20 },
    ];
    const v = clusterViolation(cluster, "/repo", cluster[1]);
    expect(v.path).toBe("y.mjs");
    expect(v.line).toBe(4);
  });

  // Every site is under emitter-sdk/, so cluster.find(!isCanonical) is undefined
  // and the anchor falls back to cluster[0]; an unnamed member renders "(anon)".
  test("all-canonical cluster falls back to the first site and shows (anon)", () => {
    const cluster = [
      {
        path: "/repo/emitter-sdk/a.mjs",
        name: null,
        start: 2,
        end: 8,
        nodeCount: 20,
      },
      {
        path: "/repo/emitter-sdk/b.mjs",
        name: "named",
        start: 5,
        end: 11,
        nodeCount: 20,
      },
    ];
    const v = clusterViolation(cluster, "/repo");
    expect(v.path).toBe("emitter-sdk/a.mjs");
    expect(v.line).toBe(2);
    expect(v.detail).toContain("(anon)");
  });
});
