import { describe, test, expect } from "vitest";
import { parseSourceFile } from "../fn-metrics.mjs";
import { collectSubtrees } from "../ast-fingerprint.mjs";
import {
  FN_MIN_NODES,
  functionClones,
  clusterTier,
  clusterViolation,
} from "../dup-fn-metrics.mjs";

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
});
