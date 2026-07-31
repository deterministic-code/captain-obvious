import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  analyzeLsp,
  isAnalyzable,
  runSolidLHook,
} from "../_kit/solid-l-metrics.mjs";
import { main } from "../lint-solid-l/check.mjs";
import { cleanupTmp, mockProcessIo } from "./test-helpers.mjs";

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
    expect(analyze(`class Sub extends Base { run() { return 1; } }`)).toEqual(
      [],
    );
  });
  test("subclassing an Error base is not an LSP concern", () => {
    expect(
      analyze(
        `class MyError extends AppError { render() { throw new NotSupportedError(); } }`,
      ),
    ).toEqual([]);
  });
});

describe("solid-l-metrics / instanceof non-matches", () => {
  test("a lowercase instanceof right-hand side is not a domain ctor", () => {
    expect(analyze(`if (x instanceof widget) f();`)).toEqual([]);
  });
  test("a qualified instanceof right-hand side (ns.Type) is not flagged", () => {
    expect(analyze(`if (x instanceof ns.Kind) f();`)).toEqual([]);
  });
  test("a non-instanceof binary expression is ignored", () => {
    expect(analyze(`const n = a + b;`)).toEqual([]);
  });
});

describe("solid-l-metrics / base-class shapes", () => {
  test("a class with no extends clause has no refusal-override risk", () => {
    expect(
      analyze(`class Free { run() { throw new NotImplementedError(); } }`),
    ).toEqual([]);
  });
  test("a class with only an implements clause (no extends) is not a substitutability concern", () => {
    expect(
      analyze(
        `class Impl implements IThing { run() { throw new NotImplementedError(); } }`,
      ),
    ).toEqual([]);
  });
  test("a class extending a qualified (non-identifier) base is skipped", () => {
    expect(
      analyze(
        `class Sub extends ns.Base { run() { throw new NotImplementedError(); } }`,
      ),
    ).toEqual([]);
  });
  test("a class extending a built-in base is exempt", () => {
    expect(
      analyze(
        `class MyMap extends Map { get() { throw new NotSupportedError(); } }`,
      ),
    ).toEqual([]);
  });
  test("an override that honors the base contract is not a refusal", () => {
    expect(analyze(`class Sub extends Base { run() { return 1; } }`)).toEqual(
      [],
    );
  });
  test("a class expression extending a base is analyzed for refusals", () => {
    const v = analyze(
      `const C = class extends Base { run() { throw new NotImplementedError(); } };`,
    );
    expect(v).toHaveLength(1);
    expect(v[0].detail).toContain('base "Base"');
  });
});

describe("solid-l-metrics / isAnalyzable", () => {
  test("test files, excluded paths, and non-JS extensions are skipped", () => {
    expect(isAnalyzable("src/x.test.ts")).toBe(false);
    expect(isAnalyzable("coverage/x.js")).toBe(false);
    expect(isAnalyzable("src/x.txt")).toBe(false);
    expect(isAnalyzable("src/x.tsx")).toBe(true);
  });
});

describe("solid-l-metrics / allow marker", () => {
  test("a solid-l-allow marker suppresses the file", () => {
    expect(
      analyze(
        `// solid-l-allow: sentinel\nif (x instanceof SkipStep) return 1;`,
      ),
    ).toEqual([]);
  });
});

describe("solid-l-metrics / fileLspViolations + runner", () => {
  let root;
  let io;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "solid-l-run-"));
    io = mockProcessIo();
  });
  afterEach(async () => {
    io.restore();
    await cleanupTmp(root);
  });

  test("runSolidLHook empty argv prints usage and exits 2", async () => {
    await expect(runSolidLHook(["node", "l.mjs"])).rejects.toThrow(
      /__exit__:2/,
    );
    expect(io.text(io.stderrSpy)).toMatch(/Usage/);
  });

  test("runSolidLHook --files on a clean file prints the ok line", async () => {
    const p = join(root, "clean.ts");
    await writeFile(p, "export const x = 1;\n", "utf8");
    await runSolidLHook(["node", "l.mjs", "--files", p]);
    expect(io.exitSpy).not.toHaveBeenCalled();
    expect(io.text(io.stdoutSpy)).toContain(
      "SOLID-L: no Liskov-substitution violations",
    );
  });

  test("runSolidLHook --files on an instanceof offender exits 1 with an lsp report", async () => {
    const p = join(root, "bad.ts");
    await writeFile(
      p,
      "function f(x){ if (x instanceof SkipStep) return 1; }\n",
      "utf8",
    );
    await expect(
      runSolidLHook(["node", "l.mjs", "--files", p]),
    ).rejects.toThrow(/__exit__:1/);
    expect(io.text(io.stderrSpy)).toContain("lsp");
  });

  test("runSolidLHook --files skips a non-analyzable path (.txt)", async () => {
    const p = join(root, "notes.txt");
    await writeFile(
      p,
      "function f(x){ if (x instanceof SkipStep) return 1; }\n",
      "utf8",
    );
    await runSolidLHook(["node", "l.mjs", "--files", p]);
    expect(io.exitSpy).not.toHaveBeenCalled();
  });

  test("runSolidLHook --files on a missing file stays clean", async () => {
    await runSolidLHook(["node", "l.mjs", "--files", join(root, "gone.ts")]);
    expect(io.exitSpy).not.toHaveBeenCalled();
  });

  test("the thin wrapper main drives a clean --files run", async () => {
    const p = join(root, "wrap.ts");
    await writeFile(p, "export const x = 1;\n", "utf8");
    await main(["node", "l.mjs", "--files", p]);
    expect(io.exitSpy).not.toHaveBeenCalled();
  });
});
