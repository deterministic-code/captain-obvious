import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  findUntested,
  isProdSource,
  isTestFile,
  main,
  subjectOf,
} from "../lint-tests-with-code/check.mjs";
import {
  cleanupTmp,
  commitAllIn,
  gitIn,
  makeTempGitRepo,
  mockProcessIo,
} from "./test-helpers.mjs";

describe("classification helpers", () => {
  test("isTestFile matches .test/.spec and tier suffixes only", () => {
    expect(isTestFile("src/foo.test.ts")).toBe(true);
    expect(isTestFile("src/__tests__/foo.integration.test.mjs")).toBe(true);
    expect(isTestFile("src/foo.spec.tsx")).toBe(true);
    expect(isTestFile("src/foo.ts")).toBe(false);
  });

  test("isProdSource excludes tests, barrels, types, and out-of-scope paths", () => {
    expect(isProdSource("src/foo.ts")).toBe(true);
    expect(isProdSource("hooks/git/bar.mjs")).toBe(true);
    expect(isProdSource("src/foo.test.ts")).toBe(false);
    expect(isProdSource("src/index.ts")).toBe(false);
    expect(isProdSource("src/types.ts")).toBe(false);
    expect(isProdSource("src/foo.d.ts")).toBe(false);
    expect(isProdSource("src/readme.md")).toBe(false); // in scope but not lintable
    expect(isProdSource("bin/install.mjs")).toBe(false); // out of scope
  });

  test("subjectOf strips test/tier suffixes and plain extensions", () => {
    expect(subjectOf("src/foo.ts")).toBe("foo");
    expect(subjectOf("src/__tests__/foo.test.ts")).toBe("foo");
    expect(subjectOf("a/b/foo.integration.test.mjs")).toBe("foo");
  });
});

describe("findUntested", () => {
  test("flags a prod change with no matching test change", () => {
    const r = findUntested([
      { status: "M", path: "src/foo.ts" },
      { status: "A", path: "src/bar.ts" },
      { status: "M", path: "src/bar.test.ts" },
    ]);
    expect(r).toEqual([{ status: "M", path: "src/foo.ts" }]);
  });

  test("passes when every prod subject has a test moving with it", () => {
    expect(
      findUntested([
        { status: "M", path: "src/foo.ts" },
        { status: "M", path: "src/foo.test.ts" },
      ]),
    ).toEqual([]);
  });
});

describe("lint-tests-with-code / main", () => {
  let repo, io;

  async function stage(repo, path, body = "export const x = 1;\n") {
    const abs = join(repo, path);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, body, "utf8");
    await gitIn(repo, ["add", path]);
  }

  beforeEach(async () => {
    repo = await makeTempGitRepo("twc-");
    io = mockProcessIo();
  });

  afterEach(async () => {
    io.restore();
    await cleanupTmp(repo);
  });

  test("unknown mode prints usage and exits 2", async () => {
    await expect(main(["node", "s", "--all"], { cwd: repo })).rejects.toThrow(
      /__exit__:2/,
    );
    expect(io.text(io.stderrSpy)).toMatch(/Usage:/);
  });

  test("new source file with no test is blocked (exit 1)", async () => {
    await stage(repo, "src/foo.ts");
    await expect(
      main(["node", "s", "--staged"], { cwd: repo }),
    ).rejects.toThrow(/__exit__:1/);
    expect(io.text(io.stderrSpy)).toMatch(/src\/foo\.ts: new file has no test/);
  });

  test("source change with a matching staged test passes", async () => {
    await stage(repo, "src/foo.ts");
    await stage(
      repo,
      "src/foo.test.ts",
      "import { expect, test } from 'vitest';\n",
    );
    await main(["node", "s", "--staged"], { cwd: repo });
    expect(io.exitSpy).not.toHaveBeenCalled();
    expect(io.text(io.stdoutSpy)).toMatch(
      /every changed source file moves with a test/,
    );
  });

  test("modifying committed code without touching its test is blocked", async () => {
    await stage(repo, "src/foo.ts");
    await commitAllIn(repo, "seed foo (no test)");
    await stage(repo, "src/foo.ts", "export const x = 2;\n");
    await expect(
      main(["node", "s", "--staged"], { cwd: repo }),
    ).rejects.toThrow(/__exit__:1/);
    expect(io.text(io.stderrSpy)).toMatch(/changed without touching its test/);
  });

  test("--warn downgrades to advisory (no exit)", async () => {
    await stage(repo, "src/foo.ts");
    await main(["node", "s", "--staged", "--warn"], { cwd: repo });
    expect(io.exitSpy).not.toHaveBeenCalled();
    expect(io.text(io.stderrSpy)).toMatch(/new file has no test/);
  });
});
