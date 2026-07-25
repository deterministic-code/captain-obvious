import { describe, expect, test } from "vitest";
import {
  diffFingerprint,
  fingerprintNamedType,
  fingerprintOf,
  keyToTarget,
  parseScopes,
} from "../frozen-interfaces-metrics.mjs";
import { parseSourceFile } from "../fn-metrics.mjs";

const firstDecl = (src) => {
  const sf = parseSourceFile("f.ts", src);
  const node = sf.statements.find((s) => s.name);
  return fingerprintOf(sf, node);
};

describe("frozen-interfaces / fingerprintOf", () => {
  test("captures the constructor param list", () => {
    const fp = firstDecl("class C { constructor(a, b = 1) {} }");
    expect(fp.constructor).toBe("(a, b = 1)");
  });
  test("captures public methods with their arity", () => {
    const fp = firstDecl("class C { write() {} add(x) {} }");
    expect(fp.members).toEqual({ write: "()", add: "(x)" });
  });
  test("excludes private # and `private`-modifier members from the interface", () => {
    const fp = firstDecl(
      "class C { pub() {} #secret() {} private hidden() {} }",
    );
    expect(fp.members).toEqual({ pub: "()" });
  });
  test("records heritage extends/implements for an interface", () => {
    const fp = firstDecl("interface I extends A, B {}");
    expect(fp.kind).toBe("interface");
    expect(fp.heritage.extends).toEqual(["A", "B"]);
  });
  test("keeps TS param and return types when present", () => {
    const fp = firstDecl("class C { run(x: string): Promise<void> {} }");
    expect(fp.members.run).toBe("(x: string): Promise<void>");
  });
});

describe("frozen-interfaces / fingerprintNamedType", () => {
  const src = "export class A { m() {} }\nexport class B { n(x) {} }";
  test("finds the named declaration and fingerprints it", () => {
    const found = fingerprintNamedType(parseSourceFile("f.ts", src), "B");
    expect(found.fingerprint.members).toEqual({ n: "(x)" });
  });
  test("reports the declaration's 1-based line for the violation location", () => {
    const found = fingerprintNamedType(parseSourceFile("f.ts", src), "B");
    expect(found.line).toBe(2);
  });
  test("returns null when no declaration matches the frozen name", () => {
    expect(
      fingerprintNamedType(parseSourceFile("f.ts", src), "Nope"),
    ).toBeNull();
  });
});

describe("frozen-interfaces / parseScopes", () => {
  test("no tokens means all sections are frozen", () => {
    expect(parseScopes("")).toEqual(["heritage", "constructor", "members"]);
  });
  test("aliases resolve to canonical section names", () => {
    expect(parseScopes("methods, implements")).toEqual(["members", "heritage"]);
  });
  test("an unknown scope token throws rather than silently freezing nothing", () => {
    expect(() => parseScopes("bogus")).toThrow(/unknown frozen scope/);
  });
});

describe("frozen-interfaces / keyToTarget", () => {
  test("splits a path#Name target on the final hash", () => {
    expect(keyToTarget("scripts/codegen/lib/writers.mjs#EmitPlan")).toEqual({
      path: "scripts/codegen/lib/writers.mjs",
      name: "EmitPlan",
    });
  });
  test("a target without a #Name throws", () => {
    expect(() => keyToTarget("scripts/x.mjs")).toThrow(
      /expected <path>#<ClassName>/,
    );
  });
});

describe("frozen-interfaces / diffFingerprint", () => {
  const base = firstDecl("class C { constructor(a) {} write() {} }");

  test("no change yields no diff", () => {
    expect(diffFingerprint(base, base, ["constructor", "members"])).toEqual([]);
  });
  test("adding a constructor arg is caught under the constructor scope", () => {
    const drifted = firstDecl("class C { constructor(a, b) {} write() {} }");
    expect(diffFingerprint(base, drifted, ["constructor"])).toEqual([
      "constructor (a) → (a, b)",
    ]);
  });
  test("adding a method arg is caught under the members scope", () => {
    const drifted = firstDecl("class C { constructor(a) {} write(x) {} }");
    expect(diffFingerprint(base, drifted, ["members"])).toEqual([
      "changed write: () → (x)",
    ]);
  });
  test("a new public method is reported as an added member", () => {
    const drifted = firstDecl(
      "class C { constructor(a) {} write() {} extra() {} }",
    );
    expect(diffFingerprint(base, drifted, ["members"])).toEqual([
      "added member extra()",
    ]);
  });
  test("scope narrowing ignores drift outside the enforced sections", () => {
    const drifted = firstDecl("class C { constructor(a, b, c) {} write() {} }");
    expect(diffFingerprint(base, drifted, ["members"])).toEqual([]);
  });
});
