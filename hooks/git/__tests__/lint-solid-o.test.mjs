import { describe, expect, test } from "vitest";
import { analyzeOcp } from "../solid-o-metrics.mjs";

const analyze = (src, path = "scripts/codegen/lib/x.mjs") =>
  analyzeOcp(path, src);

describe("solid-o-metrics / switch dispatch", () => {
  test("a switch on ≥3 string variants is an OCP smell", () => {
    const v = analyze(
      `function f(base){switch(base){case "a": return 1; case "b": return 2; case "c": return 3;}}`,
    );
    expect(v).toHaveLength(1);
    expect(v[0].kind).toBe("ocp");
    expect(v[0].detail).toContain("3 string variants");
  });
  test("fewer than 3 string arms stays under the floor", () => {
    expect(
      analyze(`switch(base){case "a": return 1; case "b": return 2;}`),
    ).toEqual([]);
  });
  test("a closed discriminant (dialect) is exempt as an exhaustive boundary", () => {
    expect(
      analyze(
        `switch(dialect){case "sqlite": return 1; case "postgres": return 2; case "mysql": return 3;}`,
      ),
    ).toEqual([]);
  });
  test("the CLI mode discriminant is exempt", () => {
    expect(
      analyze(
        `switch(mode){case "--staged": return 1; case "--all": return 2; case "--files": return 3;}`,
      ),
    ).toEqual([]);
  });
  test("numeric case labels are not string dispatch", () => {
    expect(
      analyze(`switch(n){case 1: return 1; case 2: return 2; case 3: return 3;}`),
    ).toEqual([]);
  });
});

describe("solid-o-metrics / if-else-if chain dispatch", () => {
  test("a ≥3-arm string-equality chain on one operand is an OCP smell", () => {
    const v = analyze(
      `function f(t){if(t==="a")return 1; else if(t==="b")return 2; else if(t==="c")return 3;}`,
    );
    expect(v).toHaveLength(1);
    expect(v[0].detail).toContain('if/else-if chain on "t"');
  });
  test("a chain mixing operands is not a single dispatch", () => {
    expect(
      analyze(
        `function f(t,u){if(t==="a")return 1; else if(u==="b")return 2; else if(t==="c")return 3;}`,
      ),
    ).toEqual([]);
  });
  test("a non-string condition breaks the chain", () => {
    expect(
      analyze(
        `function f(t){if(t==="a")return 1; else if(t>2)return 2; else if(t==="c")return 3;}`,
      ),
    ).toEqual([]);
  });
});

describe("solid-o-metrics / allow marker", () => {
  test("a solid-o-allow marker suppresses the file", () => {
    expect(
      analyze(
        `// solid-o-allow: intentional\nswitch(base){case "a":return 1; case "b":return 2; case "c":return 3;}`,
      ),
    ).toEqual([]);
  });
});
