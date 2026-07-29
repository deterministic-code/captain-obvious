import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  MAX_LINE_LENGTH,
  findViolations,
  lintFile,
  main,
} from "../lint-max-line-length.mjs";
import {
  cleanupTmp,
  commitAllIn,
  makeTempGitRepo,
  mockProcessIo,
} from "./test-helpers.mjs";

describe("findViolations", () => {
  test("lines within the limit yield no violation", () => {
    expect(findViolations("short\nalso short\n", 20)).toHaveLength(0);
  });

  test("an overlong line is flagged with its column and length", () => {
    const v = findViolations("ok\n" + "x".repeat(12) + "\n", 10);
    expect(v).toHaveLength(1);
    expect(v[0]).toMatchObject({ line: 2, col: 11, kind: "max-line-length" });
    expect(v[0].detail).toBe("line is 12 columns (limit 10)");
  });

  test("a trailing carriage return is not counted as a column", () => {
    // Exactly `limit` visible chars followed by \r must NOT trip the limit.
    expect(findViolations("x".repeat(10) + "\r\n", 10)).toHaveLength(0);
  });

  test("defaults to the exported MAX_LINE_LENGTH limit", () => {
    expect(findViolations("y".repeat(MAX_LINE_LENGTH + 1))).toHaveLength(1);
  });
});

describe("main / runner", () => {
  let io;
  let origCwd;
  beforeEach(() => {
    origCwd = process.cwd();
    io = mockProcessIo();
  });
  afterEach(() => {
    process.chdir(origCwd);
    io.restore();
  });

  const overlong = () => "const s = " + '"'.repeat(MAX_LINE_LENGTH + 1) + ";\n";

  test("unknown mode prints usage and exits 2", async () => {
    await expect(main(["node", "s.mjs", "--bogus"])).rejects.toThrow(/__exit__:2/);
    expect(io.text(io.stderrSpy)).toMatch(/Usage:/);
  });

  test("--files on a file within the limit resolves without exit", async () => {
    const repo = await makeTempGitRepo("mll-clean-");
    const p = join(repo, "ok.ts");
    await writeFile(p, "export const x = 1;\n", "utf8");
    process.chdir(repo);
    await main(["node", "s.mjs", "--files", p]);
    expect(io.exitSpy).not.toHaveBeenCalled();
    await cleanupTmp(repo);
  });

  test("--files on an overlong line writes the violation and exits 1", async () => {
    const repo = await makeTempGitRepo("mll-dirty-");
    const p = join(repo, "wide.ts");
    await writeFile(p, overlong(), "utf8");
    process.chdir(repo);
    await expect(main(["node", "s.mjs", "--files", p])).rejects.toThrow(/__exit__:1/);
    expect(io.text(io.stderrSpy)).toMatch(/max-line-length/);
    await cleanupTmp(repo);
  });

  test("--files skips non-lintable paths (collect returns [])", async () => {
    const repo = await makeTempGitRepo("mll-skip-");
    const p = join(repo, "wide.txt");
    await writeFile(p, overlong(), "utf8");
    process.chdir(repo);
    await main(["node", "s.mjs", "--files", p]);
    expect(io.exitSpy).not.toHaveBeenCalled();
    await cleanupTmp(repo);
  });

  test("--staged clean repo prints the staged-diff OK line", async () => {
    const repo = await makeTempGitRepo("mll-staged-");
    await writeFile(join(repo, "ok.ts"), "export const x = 1;\n", "utf8");
    await commitAllIn(repo, "seed");
    process.chdir(repo);
    await main(["node", "s.mjs", "--staged"]);
    expect(io.exitSpy).not.toHaveBeenCalled();
    expect(io.text(io.stdoutSpy)).toMatch(/no overlong lines/);
    await cleanupTmp(repo);
  });

  test("--all overlong repo flags the violation and exits 1", async () => {
    const repo = await makeTempGitRepo("mll-all-");
    await writeFile(join(repo, "wide.ts"), overlong(), "utf8");
    await commitAllIn(repo, "seed");
    process.chdir(repo);
    await expect(main(["node", "s.mjs", "--all"])).rejects.toThrow(/__exit__:1/);
    expect(io.text(io.stderrSpy)).toMatch(/max-line-length/);
    await cleanupTmp(repo);
  });

  test("--warn downgrades a violation to advisory (no exit)", async () => {
    const repo = await makeTempGitRepo("mll-warn-");
    const p = join(repo, "wide.ts");
    await writeFile(p, overlong(), "utf8");
    process.chdir(repo);
    await main(["node", "s.mjs", "--files", p, "--warn"]);
    expect(io.exitSpy).not.toHaveBeenCalled();
    expect(io.text(io.stderrSpy)).toMatch(/advisory — not blocking/);
    await cleanupTmp(repo);
  });
});

describe("lintFile", () => {
  let tmpRoot;
  beforeEach(async () => {
    tmpRoot = await mkdtemp(join(tmpdir(), "mll-file-"));
  });
  afterEach(async () => {
    await cleanupTmp(tmpRoot);
  });

  test("tags a violation with the given path", async () => {
    const p = join(tmpRoot, "wide.ts");
    await writeFile(p, "z".repeat(MAX_LINE_LENGTH + 1) + "\n", "utf8");
    const v = await lintFile(p);
    expect(v).toHaveLength(1);
    expect(v[0].path).toBe(p);
  });
});
