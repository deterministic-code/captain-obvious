import { describe, expect, test } from "vitest";
import {
  FN_LIMITS,
  analyzeSource,
  functionsInDiff,
  isAnalyzable,
} from "../fn-metrics.mjs";

const byName = (fns, name) => {
  const hit = fns.find((fn) => fn.name === name);
  if (!hit) throw new Error(`no fn named ${name} in ${JSON.stringify(fns)}`);
  return hit;
};

describe("fn-metrics / analyzeSource statements + complexity", () => {
  test("trivial function has 1 statement and complexity 1", () => {
    const fns = analyzeSource("f.ts", "function f(a){ return a + 1; }\n");
    expect(fns).toHaveLength(1);
    expect(fns[0].name).toBe('"f"');
    expect(fns[0].statements).toBe(1);
    expect(fns[0].complexity).toBe(1);
  });

  test("if + && + for + inner-if: complexity 5, statements 6", () => {
    const src = [
      "function g(x, y, z) {",
      "  if (x > 0 && y) {",
      "    return 1;",
      "  }",
      "  for (let i = 0; i < 10; i++) {",
      "    if (z) console.log(i);",
      "  }",
      "  return 0;",
      "}",
      "",
    ].join("\n");
    const g = byName(analyzeSource("g.ts", src), '"g"');
    expect(g.complexity).toBe(5);
    expect(g.statements).toBe(6);
  });

  test("switch cases + catch + ?? contribute; default + switch do not", () => {
    const src = [
      "function sw(v) {",
      "  try {",
      "    switch (v) {",
      "      case 1:",
      '        return "a";',
      "      case 2:",
      '        return "b";',
      "      default:",
      '        return v ?? "z";',
      "    }",
      "  } catch (e) {",
      '    return "err";',
      "  }",
      "}",
      "",
    ].join("\n");
    const sw = byName(analyzeSource("sw.ts", src), '"sw"');
    expect(sw.complexity).toBe(5);
  });

  test("multi-declarator VariableStatement counts as one statement", () => {
    const fns = analyzeSource(
      "m.ts",
      "function multi() { const a = 1, b = 2; return a + b; }\n",
    );
    expect(fns[0].statements).toBe(2);
    expect(fns[0].complexity).toBe(1);
  });

  test("nested arrow is its own entry; outer excludes the inner's branches", () => {
    const src = [
      "function outer(items) {",
      "  const doubled = items.map((n) => (n > 0 ? n * 2 : 0));",
      "  if (doubled.length) {",
      "    return doubled;",
      "  }",
      "  return [];",
      "}",
      "",
    ].join("\n");
    const fns = analyzeSource("o.ts", src);
    expect(fns).toHaveLength(2);
    const outer = byName(fns, '"outer"');
    const inner = byName(fns, "(anonymous)");
    expect(outer.complexity).toBe(2);
    expect(outer.statements).toBe(4);
    expect(inner.complexity).toBe(2);
    expect(inner.statements).toBe(0);
  });
});

describe("fn-metrics / analyzeSource lines counting", () => {
  test("lines excludes blank and comment-only physical lines", () => {
    const src = [
      "function h() {",
      "  const a = 1;",
      "",
      "  // a comment-only line",
      "  const b = 2;",
      "  /* block comment only */",
      "  return a + b;",
      "}",
      "",
    ].join("\n");
    const h = byName(analyzeSource("h.ts", src), '"h"');
    expect(h.startLine).toBe(1);
    expect(h.endLine).toBe(8);
    expect(h.lines).toBe(5);
    expect(h.statements).toBe(3);
    expect(h.complexity).toBe(1);
  });
});

describe("fn-metrics / analyzeSource names", () => {
  test("constructor, var-named function, and anonymous are named correctly", () => {
    const src = [
      "class C { constructor() { this.x = 1; } }",
      "const named = function () { return 1; };",
      "[1].forEach(function () { return 0; });",
      "",
    ].join("\n");
    const names = analyzeSource("n.ts", src).map((fn) => fn.name);
    expect(names).toEqual(["constructor", '"named"', "(anonymous)"]);
  });
});

describe("fn-metrics / functionsInDiff", () => {
  const fn = { name: '"x"', startLine: 5, endLine: 20 };

  test("kept when an added line falls inside the span", () => {
    expect(functionsInDiff([fn], new Set([10]))).toEqual([fn]);
  });

  test("dropped when no added line intersects the span", () => {
    expect(functionsInDiff([fn], new Set([30]))).toEqual([]);
  });

  test("kept on the boundary start line", () => {
    expect(functionsInDiff([fn], new Set([5]))).toEqual([fn]);
  });

  test("kept on the boundary end line", () => {
    expect(functionsInDiff([fn], new Set([20]))).toEqual([fn]);
  });
});

describe("fn-metrics / isAnalyzable", () => {
  test.each([".ts", ".tsx", ".mjs", ".cjs", ".js", ".jsx"])(
    "analyzable JS/TS extension %s",
    (ext) => {
      expect(isAnalyzable(`scripts/hooks/foo${ext}`)).toBe(true);
    },
  );

  test.each([".rs", ".cs", ".txt", ".py"])(
    "non-JS extension %s is not analyzable",
    (ext) => {
      expect(isAnalyzable(`scripts/hooks/foo${ext}`)).toBe(false);
    },
  );

  test("paths under excluded dirs are not analyzable even with a JS extension", () => {
    expect(isAnalyzable("node_modules/pkg/index.js")).toBe(false);
    expect(isAnalyzable("dist/bundle.js")).toBe(false);
  });

  test("test files are not analyzable (suite callbacks are legitimately long)", () => {
    expect(isAnalyzable("scripts/foo.test.ts")).toBe(false);
    expect(isAnalyzable("scripts/foo.spec.mjs")).toBe(false);
    expect(isAnalyzable("scripts/__tests__/foo.mjs")).toBe(false);
    expect(isAnalyzable("scripts/hooks/foo.mjs")).toBe(true);
  });
});

describe("fn-metrics / FN_LIMITS", () => {
  test("documented default limits", () => {
    expect(FN_LIMITS).toEqual({
      lines: 60,
      statements: 20,
      complexity: 15,
      params: 3,
    });
  });
});

describe("fn-metrics / analyzeSource params", () => {
  test("counts declared parameters", () => {
    const fns = analyzeSource("p.ts", "function f(a, b, c) { return a; }\n");
    expect(byName(fns, '"f"').params).toBe(3);
  });

  test("zero-parameter function reports 0", () => {
    const fns = analyzeSource("p.ts", "function f() { return 1; }\n");
    expect(byName(fns, '"f"').params).toBe(0);
  });

  test("rest, default, and destructured params each count once", () => {
    const src = "function f({ a }, b = 2, ...rest) { return b; }\n";
    expect(byName(analyzeSource("p.ts", src), '"f"').params).toBe(3);
  });

  test("an explicit this parameter is not counted", () => {
    const src = "function f(this: Ctx, a, b) { return a; }\n";
    expect(byName(analyzeSource("p.ts", src), '"f"').params).toBe(2);
  });
});
