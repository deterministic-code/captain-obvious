import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findEmptyTests, main } from "../lint-empty-tests/check.mjs";
import { cleanupTmp, mockProcessIo } from "./test-helpers.mjs";

describe("findEmptyTests", () => {
  test("flags a test with a body but no assertion", () => {
    const v = findEmptyTests(`test("adds", () => {\n  const x = 1 + 1;\n});\n`);
    expect(v).toHaveLength(1);
    expect(v[0]).toMatchObject({ kind: "test-no-assertion", line: 1 });
  });

  test("flags an empty callback body", () => {
    const v = findEmptyTests(`it("todo", () => {});\n`);
    expect(v.map((x) => x.kind)).toEqual(["test-no-assertion"]);
  });

  test("flags a pending test with no callback", () => {
    const v = findEmptyTests(`it("later");\n`);
    expect(v.map((x) => x.kind)).toEqual(["test-no-body"]);
  });

  test("passes a test that asserts (expect / node:assert / toThrow)", () => {
    expect(findEmptyTests(`it("a", () => { expect(1).toBe(1); });\n`)).toEqual(
      [],
    );
    expect(findEmptyTests(`test("b", () => { assert(ok); });\n`)).toEqual([]);
    expect(
      findEmptyTests(`it("c", () => { expect(fn).toThrow(); });\n`),
    ).toEqual([]);
  });

  test("tolerates an unbalanced call without crashing", () => {
    expect(findEmptyTests(`it(`).map((x) => x.kind)).toEqual(["test-no-body"]);
  });
});

describe("lint-empty-tests / main", () => {
  let dir, io;

  async function file(name, body) {
    const p = join(dir, name);
    await writeFile(p, body, "utf8");
    return p;
  }

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "let-"));
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

  test("--files flags an assertion-free test and exits 1", async () => {
    const bad = await file("a.test.ts", `it("x", () => {});\n`);
    await expect(main(["node", "s", "--files", bad])).rejects.toThrow(
      /__exit__:1/,
    );
    expect(io.text(io.stderrSpy)).toContain("test-no-assertion");
  });

  test("--files ignores non-test files and passes", async () => {
    const notTest = await file("a.ts", `export const f = () => {};\n`);
    await main(["node", "s", "--files", notTest]);
    expect(io.exitSpy).not.toHaveBeenCalled();
    expect(io.text(io.stdoutSpy)).toMatch(/no empty or assertion-free tests/);
  });

  test("--warn downgrades to advisory (no exit)", async () => {
    const bad = await file("a.test.ts", `it("x", () => {});\n`);
    await main(["node", "s", "--files", bad, "--warn"]);
    expect(io.exitSpy).not.toHaveBeenCalled();
    expect(io.text(io.stderrSpy)).toContain("test-no-assertion");
  });
});
