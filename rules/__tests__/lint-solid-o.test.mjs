import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { analyzeOcp, isAnalyzable, runSolidOHook } from "../_kit/solid-o-metrics.mjs";
import { main } from "../lint-solid-o/check.mjs";
import { cleanupTmp, mockProcessIo } from "./test-helpers.mjs";

const analyze = (src, path = "scripts/codegen/lib/x.mjs") =>
  analyzeOcp(path, src);

const THREE_ARM_SWITCH = `function f(base){switch(base){case "a": return 1; case "b": return 2; case "c": return 3;}}`;

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
  test("a default clause and numeric cases are not counted among the string arms", () => {
    expect(
      analyze(
        `switch(base){case "a": return 1; case 2: return 2; default: return 0;}`,
      ),
    ).toEqual([]);
  });
  test("a switch whose discriminant text starts with a non-identifier is not exhaustive-exempt", () => {
    const v = analyze(
      `switch(1 + base){case "a": return 1; case "b": return 2; case "c": return 3;}`,
    );
    expect(v).toHaveLength(1);
    expect(v[0].kind).toBe("ocp");
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
  test("a bare non-binary condition (if (flag)) breaks the chain", () => {
    expect(
      analyze(
        `function f(t,flag){if(t==="a")return 1; else if(flag)return 2; else if(t==="c")return 3;}`,
      ),
    ).toEqual([]);
  });
});

describe("solid-o-metrics / if-else-if operand shapes", () => {
  test("the reversed form (\"a\" === t) is still recognized as one operand", () => {
    const v = analyze(
      `function f(t){if("a"===t)return 1; else if("b"===t)return 2; else if("c"===t)return 3;}`,
    );
    expect(v).toHaveLength(1);
  });
  test("a chain ending in a plain else block still counts its if arms", () => {
    const v = analyze(
      `function f(t){if(t==="a")return 1; else if(t==="b")return 2; else if(t==="c")return 3; else { return 0; }}`,
    );
    expect(v).toHaveLength(1);
  });
  test("a two-arm chain closed by an else block stays under the floor", () => {
    expect(
      analyze(`function f(t){if(t==="a")return 1; else if(t==="b")return 2; else { return 0; }}`),
    ).toEqual([]);
  });
  test("an equality against a non-literal on both sides breaks the chain", () => {
    expect(
      analyze(`function f(t,u){if(t===u)return 1; else if(t==="b")return 2; else if(t==="c")return 3;}`),
    ).toEqual([]);
  });
  test("a loose == string equality is still string dispatch", () => {
    const v = analyze(
      `function f(t){if(t=="a")return 1; else if(t=="b")return 2; else if(t=="c")return 3;}`,
    );
    expect(v).toHaveLength(1);
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

describe("solid-o-metrics / isAnalyzable", () => {
  test("test files, excluded paths, and non-JS extensions are skipped", () => {
    expect(isAnalyzable("src/x.spec.ts")).toBe(false);
    expect(isAnalyzable("dist/x.js")).toBe(false);
    expect(isAnalyzable("src/x.json")).toBe(false);
    expect(isAnalyzable("src/x.mjs")).toBe(true);
  });
});

describe("solid-o-metrics / fileOcpViolations + runner", () => {
  let root;
  let io;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "solid-o-run-"));
    io = mockProcessIo();
  });
  afterEach(async () => {
    io.restore();
    await cleanupTmp(root);
  });

  test("runSolidOHook empty argv prints usage and exits 2", async () => {
    await expect(runSolidOHook(["node", "o.mjs"])).rejects.toThrow(
      /__exit__:2/,
    );
    expect(io.text(io.stderrSpy)).toMatch(/Usage/);
  });

  test("runSolidOHook --files on a clean file prints the ok line", async () => {
    const p = join(root, "clean.mjs");
    await writeFile(p, "export const x = 1;\n", "utf8");
    await runSolidOHook(["node", "o.mjs", "--files", p]);
    expect(io.exitSpy).not.toHaveBeenCalled();
    expect(io.text(io.stdoutSpy)).toContain(
      "SOLID-O: no open/closed violations",
    );
  });

  test("runSolidOHook --files on a switch offender exits 1 with an ocp report", async () => {
    const p = join(root, "bad.mjs");
    await writeFile(p, THREE_ARM_SWITCH, "utf8");
    await expect(
      runSolidOHook(["node", "o.mjs", "--files", p]),
    ).rejects.toThrow(/__exit__:1/);
    expect(io.text(io.stderrSpy)).toContain("ocp");
  });

  test("runSolidOHook --files skips a non-analyzable path (.json)", async () => {
    const p = join(root, "data.json");
    await writeFile(p, THREE_ARM_SWITCH, "utf8");
    await runSolidOHook(["node", "o.mjs", "--files", p]);
    expect(io.exitSpy).not.toHaveBeenCalled();
  });

  test("runSolidOHook --files on a missing file stays clean", async () => {
    await runSolidOHook(["node", "o.mjs", "--files", join(root, "gone.mjs")]);
    expect(io.exitSpy).not.toHaveBeenCalled();
  });

  test("the thin wrapper main drives a clean --files run", async () => {
    const p = join(root, "wrap.mjs");
    await writeFile(p, "export const x = 1;\n", "utf8");
    await main(["node", "o.mjs", "--files", p]);
    expect(io.exitSpy).not.toHaveBeenCalled();
  });
});
