import { describe, expect, test } from "vitest";
import { analyzeLsp } from "../solid-l-metrics.mjs";

const analyze = (src, path = "backend/src/services/custom/x.ts") =>
  analyzeLsp(path, src);

describe("solid-l-metrics / instanceof discrimination", () => {
  test("branching on a domain subtype defeats substitutability", () => {
    const v = analyze(`function f(x){ if (x instanceof SkipStep) return 1; }`);
    expect(v).toHaveLength(1);
    expect(v[0].kind).toBe("lsp");
    expect(v[0].detail).toContain("instanceof SkipStep");
  });
  test("a built-in guard (Map) is exempt", () => {
    expect(analyze(`if (x instanceof Map) x.clear();`)).toEqual([]);
  });
  test("an Error-subclass guard is idiomatic, not an LSP break", () => {
    expect(analyze(`if (err instanceof BusinessError) throw err;`)).toEqual([]);
  });
  test("an Exception-suffixed library error is also exempt", () => {
    expect(analyze(`if (e instanceof YAMLException) show(e);`)).toEqual([]);
  });
});

describe("solid-l-metrics / refusing override", () => {
  test("a subtype overriding a base method with a refusal is flagged", () => {
    const v = analyze(
      `class InMemoryRepo extends ICrudRepository { query() { throw new NotImplementedError(); } }`,
    );
    expect(v).toHaveLength(1);
    expect(v[0].detail).toContain('base "ICrudRepository"');
  });
  test("a plain override that honors the contract is fine", () => {
    expect(
      analyze(`class Sub extends Base { run() { return 1; } }`),
    ).toEqual([]);
  });
  test("subclassing an Error base is not an LSP concern", () => {
    expect(
      analyze(
        `class MyError extends AppError { render() { throw new NotSupportedError(); } }`,
      ),
    ).toEqual([]);
  });
});

describe("solid-l-metrics / allow marker", () => {
  test("a solid-l-allow marker suppresses the file", () => {
    expect(
      analyze(`// solid-l-allow: sentinel\nif (x instanceof SkipStep) return 1;`),
    ).toEqual([]);
  });
});
