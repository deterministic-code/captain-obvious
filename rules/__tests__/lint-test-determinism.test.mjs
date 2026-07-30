import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findViolations, main } from "../lint-test-determinism/check.mjs";
import { cleanupTmp, mockProcessIo } from "./test-helpers.mjs";

describe("findViolations", () => {
  test("flags each nondeterministic source, sorted by position", () => {
    const src = [
      "const a = Date.now();",
      "const b = Math.random();",
      "const c = new Date();",
      "const d = performance.now();",
      "await fetch('/x');",
      "const e = new XMLHttpRequest();",
    ].join("\n");
    expect(findViolations(src).map((v) => v.kind)).toEqual([
      "date-now",
      "math-random",
      "new-date-now",
      "performance-now",
      "network-fetch",
      "network-xhr",
    ]);
  });

  test("orders two hits on the same line by column", () => {
    expect(findViolations("const x = Math.random() + Date.now();\n").map((v) => v.kind)).toEqual([
      "math-random",
      "date-now",
    ]);
  });

  test("does not flag deterministic date construction or timers", () => {
    const src = "const t = new Date('2020-01-01'); setTimeout(fn, 10);\n";
    expect(findViolations(src)).toEqual([]);
  });

  test("ignores matches inside strings and comments", () => {
    expect(findViolations(`// Date.now() here\nconst s = "Math.random()";\n`)).toEqual([]);
  });
});

describe("lint-test-determinism / main", () => {
  let dir, io;

  async function file(name, body) {
    const p = join(dir, name);
    await writeFile(p, body, "utf8");
    return p;
  }

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "ltd-"));
    io = mockProcessIo();
  });

  afterEach(async () => {
    io.restore();
    await cleanupTmp(dir);
  });

  test("unknown mode prints usage and exits 2", async () => {
    await expect(main(["node", "s", "--bogus"])).rejects.toThrow(/__exit__:2/);
    expect(io.text(io.stderrSpy)).toMatch(/Usage:/);
  });

  test("--files flags a nondeterministic test and exits 1", async () => {
    const bad = await file("a.test.ts", `it("x", () => { expect(Date.now()).toBeGreaterThan(0); });\n`);
    await expect(main(["node", "s", "--files", bad])).rejects.toThrow(/__exit__:1/);
    expect(io.text(io.stderrSpy)).toContain("date-now");
  });

  test("--files ignores non-test files", async () => {
    const notTest = await file("a.ts", `export const now = () => Date.now();\n`);
    await main(["node", "s", "--files", notTest]);
    expect(io.exitSpy).not.toHaveBeenCalled();
    expect(io.text(io.stdoutSpy)).toMatch(/no nondeterministic sources in tests/);
  });

  test("--warn downgrades to advisory (no exit)", async () => {
    const bad = await file("a.test.ts", `it("x", () => { Math.random(); });\n`);
    await main(["node", "s", "--files", bad, "--warn"]);
    expect(io.exitSpy).not.toHaveBeenCalled();
    expect(io.text(io.stderrSpy)).toContain("math-random");
  });
});
