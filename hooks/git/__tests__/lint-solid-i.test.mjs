import { describe, expect, test } from "vitest";
import {
  analyzeIsp,
  classifyMethod,
  implementsClause,
} from "../solid-i-metrics.mjs";
import { parseSourceFile } from "../fn-metrics.mjs";

const wrap = (body) => `export class C implements IThing {\n${body}\n}`;
const analyze = (src, path = "typescript/src/repositories/x/C.ts") =>
  analyzeIsp(path, src);

const firstMethod = (src) => {
  const sf = parseSourceFile("f.ts", src);
  const cls = sf.statements.find((s) => s.kind && s.name?.text === "C");
  return cls.members[0];
};

describe("solid-i-metrics / implementsClause", () => {
  test("returns the implemented interface names", () => {
    const sf = parseSourceFile("f.ts", "class C implements IA, IB {}");
    expect(implementsClause(sf.statements[0])).toEqual(["IA", "IB"]);
  });
  test("unwraps a generic implements clause to the head identifier", () => {
    const sf = parseSourceFile(
      "f.ts",
      "class C implements ICrudRepository<T> {}",
    );
    expect(implementsClause(sf.statements[0])).toEqual(["ICrudRepository"]);
  });
  test("a class with no implements clause yields no names", () => {
    const sf = parseSourceFile("f.ts", "class C extends Base {}");
    expect(implementsClause(sf.statements[0])).toEqual([]);
  });
});

describe("solid-i-metrics / classifyMethod", () => {
  test("an empty body is a hollow stub", () => {
    expect(classifyMethod(firstMethod(wrap("  a() {}")))).toBe("stub");
  });
  test("a lone generic throw is a hollow stub", () => {
    expect(
      classifyMethod(firstMethod(wrap('  a() { throw new Error("boom"); }'))),
    ).toBe("stub");
  });
  test("a NotImplementedError throw is an explicit refusal", () => {
    expect(
      classifyMethod(
        firstMethod(wrap("  a() { throw new NotImplementedError(); }")),
      ),
    ).toBe("refusal");
  });
  test("a 'not supported' message throw is an explicit refusal", () => {
    expect(
      classifyMethod(
        firstMethod(wrap('  a() { throw new Error("not supported"); }')),
      ),
    ).toBe("refusal");
  });
  test("the verb form 'does not support' is also a refusal", () => {
    expect(
      classifyMethod(
        firstMethod(
          wrap('  a() { throw new Error("does not support raw SQL"); }'),
        ),
      ),
    ).toBe("refusal");
  });
  test("a real body fulfills the contract", () => {
    expect(
      classifyMethod(firstMethod(wrap("  a() { return this.x + 1; }"))),
    ).toBe("ok");
  });
  test("a plain empty-return body is treated as a real (minimal) implementation", () => {
    expect(classifyMethod(firstMethod(wrap("  a() { return []; }")))).toBe(
      "ok",
    );
  });
});

describe("solid-i-metrics / analyzeIsp violations", () => {
  test("an explicit refusal is flagged even as the only stub", () => {
    const v = analyze(wrap('  query() { throw new Error("not supported"); }'));
    expect(v).toHaveLength(1);
    expect(v[0].kind).toBe("isp");
    expect(v[0].detail).toContain('"C"');
    expect(v[0].detail).toContain("IThing");
    expect(v[0].detail).toContain("query");
  });

  test("a single non-refusal stub is below the limit and not flagged", () => {
    expect(analyze(wrap('  a() { throw new Error("boom"); }'))).toHaveLength(0);
  });

  test("two hollow stubs cross the limit and are flagged", () => {
    expect(analyze(wrap("  a() {}\n  b() {}"))).toHaveLength(1);
  });

  test("one empty and one throw-only stub together are flagged", () => {
    expect(
      analyze(wrap('  a() {}\n  b() { throw new Error("x"); }')),
    ).toHaveLength(1);
  });

  test("a fully implemented class is clean", () => {
    const src = wrap("  a() { return this.x; }\n  b() { return this.y; }");
    expect(analyze(src)).toHaveLength(0);
  });

  test("plain return bodies are not counted as unfulfilled (precision carve-out)", () => {
    expect(
      analyze(wrap("  a() { return []; }\n  b() { return null; }")),
    ).toHaveLength(0);
  });

  test("an abstract class is skipped — abstract methods defer to subclasses", () => {
    const src =
      "export abstract class C implements IThing {\n  a() {}\n  b() {}\n}";
    expect(analyze(src)).toHaveLength(0);
  });

  test("a class without an implements clause is not an ISP concern", () => {
    const src = "export class C {\n  a() {}\n  b() {}\n}";
    expect(analyze(src)).toHaveLength(0);
  });

  test("a solid-i-allow marker suppresses the whole file", () => {
    const src = `// solid-i-allow: intentional Null Object\n${wrap(
      '  query() { throw new Error("not supported"); }',
    )}`;
    expect(analyze(src)).toHaveLength(0);
  });

  test("test files and excluded paths are not analyzed", () => {
    const src = wrap('  query() { throw new Error("not supported"); }');
    expect(
      analyze(src, "typescript/src/repositories/x/C.test.ts"),
    ).toHaveLength(0);
    expect(analyze(src, "node_modules/pkg/C.ts")).toHaveLength(0);
  });
});
