import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  analyzeIsp,
  classifyMethod,
  fileIspViolations,
  implementsClause,
  runSolidIHook,
} from "../_kit/solid-i-metrics.mjs";
import { parseSourceFile } from "../_kit/fn-metrics.mjs";
import { main } from "../lint-solid-i/check.mjs";
import { cleanupTmp, mockProcessIo } from "./test-helpers.mjs";

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
  test("a qualified (namespaced) implements head is not captured as a bare name", () => {
    const sf = parseSourceFile("f.ts", "class C implements ns.IFoo {}");
    expect(implementsClause(sf.statements[0])).toEqual([]);
  });
  test("an extends clause is ignored when collecting implements names", () => {
    const sf = parseSourceFile(
      "f.ts",
      "class C extends Base implements IThing {}",
    );
    expect(implementsClause(sf.statements[0])).toEqual(["IThing"]);
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
  test("a non-method member (property) is 'ok' — not a stub", () => {
    expect(classifyMethod(firstMethod(wrap("  x = 1;")))).toBe("ok");
  });
  test("a method-signature without a body (overload/abstract) is 'ok'", () => {
    const src =
      "export abstract class C implements IThing {\n  abstract a(): void;\n}";
    const sf = parseSourceFile("f.ts", src);
    const cls = sf.statements.find((s) => s.name?.text === "C");
    expect(classifyMethod(cls.members[0])).toBe("ok");
  });
  test("a throw of a non-`new` expression is a hollow stub, not a refusal", () => {
    expect(classifyMethod(firstMethod(wrap("  a() { throw err; }")))).toBe(
      "stub",
    );
  });
  test("a `new` throw whose name and message are both non-refusal is a stub", () => {
    expect(
      classifyMethod(
        firstMethod(wrap('  a() { throw new RangeError("bad arg"); }')),
      ),
    ).toBe("stub");
  });
  test("a `new` throw with a non-string argument is a stub (no message to inspect)", () => {
    expect(
      classifyMethod(firstMethod(wrap("  a() { throw new RangeError(123); }"))),
    ).toBe("stub");
  });
  test("a parenthesis-less `new` throw (undefined arguments) is a stub", () => {
    expect(
      classifyMethod(firstMethod(wrap("  a() { throw new CustomError; }"))),
    ).toBe("stub");
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

  test("a non-exported class (no modifiers) implementing an interface is still analyzed", () => {
    const src = "class C implements IThing {\n  a() {}\n  b() {}\n}";
    expect(analyze(src)).toHaveLength(1);
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

  test("a computed method name is reported as <computed>", () => {
    const src = wrap(
      '  [sym]() {}\n  ["other"]() { throw new Error("not supported"); }',
    );
    const v = analyze(src);
    expect(v).toHaveLength(1);
    expect(v[0].detail).toContain("<computed>");
  });

  test("a string-literal method name is reported by its text", () => {
    const v = analyze(wrap('  "do"() {}\n  "redo"() {}'));
    expect(v).toHaveLength(1);
    expect(v[0].detail).toContain("do");
  });

  test("statements that are not classes (or unnamed classes) are skipped", () => {
    const src = "export const x = 1;\nexport default class implements IT {}";
    expect(analyze(src)).toHaveLength(0);
  });
});

describe("solid-i-metrics / fileIspViolations + runner", () => {
  let root;
  let io;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "solid-i-run-"));
    io = mockProcessIo();
  });
  afterEach(async () => {
    io.restore();
    await cleanupTmp(root);
  });

  test("fileIspViolations reads a real file and reports its stubs", async () => {
    const p = join(root, "repo.ts");
    await writeFile(p, wrap("  a() {}\n  b() {}"), "utf8");
    const v = await fileIspViolations(p);
    expect(v).toHaveLength(1);
    expect(v[0].kind).toBe("isp");
  });

  test("fileIspViolations on a missing file is clean", async () => {
    expect(await fileIspViolations(join(root, "gone.ts"))).toHaveLength(0);
  });

  test("runSolidIHook empty argv prints usage and exits 2", async () => {
    await expect(runSolidIHook(["node", "i.mjs"])).rejects.toThrow(
      /__exit__:2/,
    );
    expect(io.text(io.stderrSpy)).toMatch(/Usage/);
  });

  test("runSolidIHook --files on a clean class prints the ok line", async () => {
    const p = join(root, "clean.ts");
    await writeFile(
      p,
      wrap("  a() { return this.x; }\n  b() { return this.y; }"),
      "utf8",
    );
    await runSolidIHook(["node", "i.mjs", "--files", p]);
    expect(io.exitSpy).not.toHaveBeenCalled();
    expect(io.text(io.stdoutSpy)).toContain(
      "SOLID-I: no interface-segregation violations",
    );
  });

  test("runSolidIHook --files on an offender exits 1 with an isp report", async () => {
    const p = join(root, "bad.ts");
    await writeFile(p, wrap("  a() {}\n  b() {}"), "utf8");
    await expect(
      runSolidIHook(["node", "i.mjs", "--files", p]),
    ).rejects.toThrow(/__exit__:1/);
    expect(io.text(io.stderrSpy)).toContain("isp");
  });

  test("the thin wrapper main drives a clean --files run", async () => {
    const p = join(root, "wrap.ts");
    await writeFile(p, "export class Plain {}\n", "utf8");
    await main(["node", "i.mjs", "--files", p]);
    expect(io.exitSpy).not.toHaveBeenCalled();
  });
});
