import { describe, expect, test } from "vitest";
import {
  collectSubtrees,
  objectShape,
  subtreeName,
} from "../ast-fingerprint.mjs";
import { parseSourceFile } from "../fn-metrics.mjs";
import ts from "typescript";

function firstObjectLiteral(sf) {
  let found = null;
  const visit = (node) => {
    if (found) return;
    if (ts.isObjectLiteralExpression(node)) {
      found = node;
      return;
    }
    node.forEachChild(visit);
  };
  visit(sf);
  return found;
}

function objectFps(src) {
  const sf = parseSourceFile("x.ts", src);
  return collectSubtrees(sf, { minNodes: 1 })
    .filter((s) => s.kind === "ObjectLiteralExpression")
    .map((s) => s.fp);
}

describe("fingerprint α-normalization", () => {
  test("objects differing only in identifiers and literals share a fingerprint", () => {
    const fps = objectFps(
      `const a = { x: "foo", n: 1 }; const b = { y: "bar", n: 2 };`,
    );
    expect(fps).toHaveLength(2);
    expect(fps[0]).toBe(fps[1]);
  });

  test("objects with different structure produce different fingerprints", () => {
    const differentKeyCount = objectFps(
      `const a = { x: 1 }; const b = { x: 1, y: 2 };`,
    );
    expect(differentKeyCount[0]).not.toBe(differentKeyCount[1]);

    const differentNesting = objectFps(
      `const a = { x: { deep: 1 } }; const b = { x: 1 };`,
    );
    expect(differentNesting[0]).not.toBe(differentNesting[1]);
  });

  test("regex literals normalize so two regex-valued objects match despite different patterns", () => {
    const fps = objectFps(
      `const a = { re: /^foo\\.ts$/ }; const b = { re: /^bar\\.rs$/ };`,
    );
    expect(fps[0]).toBe(fps[1]);
  });

  // A TemplateExpression (interpolated) collapses to the "Tmpl" label so its
  // interpolation structure is compared, not its literal chunks.
  test("template expressions get the Tmpl label so two differ only by interpolated names match", () => {
    const fps = objectFps(
      "const a = { s: `x${foo}y` }; const b = { s: `p${bar}q` };",
    );
    expect(fps[0]).toBe(fps[1]);
  });
});

describe("collectSubtrees minNodes floor", () => {
  test("excludes a tiny object below the node floor but includes a large one", () => {
    const src = `const tiny = { a: 1 };
const big = {
  one: { nested: [1, 2, 3] },
  two: { nested: [4, 5, 6] },
  three: (x) => x + 1,
};`;
    const kept = collectSubtrees(parseSourceFile("x.ts", src), {
      minNodes: 12,
    }).filter((s) => s.kind === "ObjectLiteralExpression");
    expect(kept.length).toBeGreaterThan(0);
    const tinyIncluded = kept.some((s) => s.nodeCount <= 3);
    expect(tinyIncluded).toBe(false);
  });
});

describe("objectShape", () => {
  test("returns sorted keys and per-prop fingerprints for a clean key:value object", () => {
    const node = firstObjectLiteral(
      parseSourceFile("x.ts", `const a = { zeta: 1, alpha: "s" };`),
    );
    const shape = objectShape(node);
    expect(shape).not.toBeNull();
    expect(shape.keys).toEqual(["alpha", "zeta"]);
    expect(shape.props.map((p) => p.key).sort()).toEqual(["alpha", "zeta"]);
    for (const prop of shape.props) {
      expect(typeof prop.valueFp).toBe("string");
    }
  });

  test("returns null for an object with a spread property", () => {
    const node = firstObjectLiteral(
      parseSourceFile("x.ts", `const base = {}; const a = { ...base, x: 1 };`),
    );
    expect(objectShape(node)).toBeNull();
  });

  test("returns null for an object with a shorthand property", () => {
    const node = firstObjectLiteral(
      parseSourceFile("x.ts", `const x = 1; const a = { x, y: 2 };`),
    );
    expect(objectShape(node)).toBeNull();
  });

  // A computed key ([expr]) makes propKey bail to null, which un-analyzes the row.
  test("returns null for an object with a computed property key", () => {
    const node = firstObjectLiteral(
      parseSourceFile("x.ts", `const k = "z"; const a = { [k]: 1, y: 2 };`),
    );
    expect(objectShape(node)).toBeNull();
  });

  test("accepts a numeric-literal key (propKey reads its text)", () => {
    const node = firstObjectLiteral(
      parseSourceFile("x.ts", `const a = { 0: "a", 1: "b" };`),
    );
    const shape = objectShape(node);
    expect(shape).not.toBeNull();
    expect(shape.keys).toEqual(["0", "1"]);
  });

  test("returns null for a non-object node", () => {
    const sf = parseSourceFile("x.ts", `const a = 1;`);
    expect(objectShape(sf)).toBeNull();
  });

  test("returns null for an empty object literal", () => {
    const node = firstObjectLiteral(parseSourceFile("x.ts", `const a = {};`));
    expect(objectShape(node)).toBeNull();
  });
});

describe("subtreeName", () => {
  function firstFn(src) {
    const sf = parseSourceFile("x.ts", src);
    let found = null;
    const visit = (node) => {
      if (found) return;
      if (
        ts.isFunctionDeclaration(node) ||
        ts.isFunctionExpression(node) ||
        ts.isArrowFunction(node) ||
        ts.isMethodDeclaration(node)
      ) {
        found = node;
        return;
      }
      node.forEachChild(visit);
    };
    visit(sf);
    return found;
  }

  test("reads the function's own identifier", () => {
    expect(subtreeName(firstFn(`function foo() {}`))).toBe("foo");
  });

  test("falls back to the bound variable name for an arrow", () => {
    expect(subtreeName(firstFn(`const bar = () => 1;`))).toBe("bar");
  });

  test("reads a property-assignment name for a method-valued property", () => {
    expect(subtreeName(firstFn(`const o = { baz: function () {} };`))).toBe(
      "baz",
    );
  });

  test("reads a string-literal property key", () => {
    expect(subtreeName(firstFn(`const o = { "quux": () => 1 };`))).toBe("quux");
  });

  test("returns null for an anonymous arrow with no binding", () => {
    expect(subtreeName(firstFn(`[].map(() => 1);`))).toBeNull();
  });

  test("reads a private-identifier method name", () => {
    expect(subtreeName(firstFn(`class C { #secret() {} }`))).toBe("#secret");
  });
});
