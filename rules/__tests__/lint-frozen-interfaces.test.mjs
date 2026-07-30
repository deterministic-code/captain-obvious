import { describe, expect, test } from "vitest";
import {
  diffFingerprint,
  fingerprintNamedType,
  fingerprintOf,
  keyToTarget,
  parseScopes,
} from "../_kit/frozen-interfaces-metrics.mjs";
import { parseSourceFile } from "../_kit/fn-metrics.mjs";

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
  test("an undefined scope string defaults to all sections", () => {
    expect(parseScopes()).toEqual(["heritage", "constructor", "members"]);
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
  test("removing a frozen member is reported under the members scope", () => {
    const drifted = firstDecl("class C { constructor(a) {} }");
    expect(diffFingerprint(base, drifted, ["members"])).toEqual([
      "removed member write()",
    ]);
  });
  test("a heritage change is caught under the heritage scope", () => {
    const before = firstDecl("class C implements A {}");
    const after = firstDecl("class C implements A, B {}");
    expect(diffFingerprint(before, after, ["heritage"])).toEqual([
      "heritage extends [] implements [A] → extends [] implements [A, B]",
    ]);
  });
  test("dropping the constructor entirely reads as (none)", () => {
    const drifted = firstDecl("class C { write() {} }");
    expect(diffFingerprint(base, drifted, ["constructor"])).toEqual([
      "constructor (a) → (none)",
    ]);
  });
});

describe("frozen-interfaces / member signature normalization", () => {
  test("captures return type on a plain method with typed params", () => {
    const fp = firstDecl("class C { run(x: number): void {} }");
    expect(fp.members.run).toBe("(x: number): void");
  });
  test("get/set accessors keep their get/set prefixes and signatures", () => {
    const fp = firstDecl(
      "class C { get size(): number { return 1 } set size(v: number) {} }",
    );
    expect(fp.members.size).toBe("get(): number | set(v: number)");
  });
  test("a bare typed property records its type and optional marker", () => {
    const fp = firstDecl("interface I { name?: string }");
    expect(fp.members.name).toBe("?: string");
  });
  test("non-public modifiers are kept in the signature prefix", () => {
    const fp = firstDecl("class C { protected run() {} static go() {} }");
    expect(fp.members.run).toBe("protected ()");
    expect(fp.members.go).toBe("static ()");
  });
  test("a computed member name collapses to its bracketed text", () => {
    const fp = firstDecl("interface I { [Symbol.iterator](): void }");
    expect(Object.keys(fp.members)[0]).toContain("Symbol.iterator");
  });
  test("overloaded interface methods merge into a union signature", () => {
    const fp = firstDecl("interface I { f(a: string): void; f(a: number): void }");
    expect(fp.members.f).toBe("(a: string): void | (a: number): void");
  });
  test("an unnamed call signature falls back to the <anon> member key", () => {
    // a call signature has no name (memberName → "<anon>") and no method flag,
    // so it renders through the property branch as just its return type.
    const fp = firstDecl("interface I { (a: string): void }");
    expect(fp.members["<anon>"]).toBe(": void");
  });
  test("a bare untyped, non-optional property records an empty signature", () => {
    // questionToken absent and no type annotation → both ternary false sides
    const fp = firstDecl("interface I { name }");
    expect(fp.members.name).toBe("");
  });
});

describe("frozen-interfaces / fingerprintNamedType skips non-matching decls", () => {
  test("a preceding unrelated declaration does not short-circuit the search", () => {
    const src = "function helper() {}\nexport class Target { m() {} }";
    const found = fingerprintNamedType(parseSourceFile("f.ts", src), "Target");
    expect(found.fingerprint.members).toEqual({ m: "()" });
  });
});
