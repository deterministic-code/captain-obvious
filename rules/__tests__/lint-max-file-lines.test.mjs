import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  MAX_FILE_LINES,
  findViolations,
  lineCount,
  lintFile,
  main,
} from "../lint-max-file-lines/check.mjs";
import {
  cleanupTmp,
  commitAllIn,
  makeTempGitRepo,
  mockProcessIo,
} from "./test-helpers.mjs";

describe("lineCount", () => {
  test("empty file counts as zero lines", () => {
    expect(lineCount("")).toBe(0);
  });

  test("a trailing newline is not counted as an extra line", () => {
    expect(lineCount("a\nb\n")).toBe(2);
  });

  test("a file without a trailing newline counts its last line", () => {
    expect(lineCount("a\nb")).toBe(2);
  });
});

describe("findViolations", () => {
  test("a file within the limit yields no violation", () => {
    expect(findViolations("a\nb\nc\n", 3)).toHaveLength(0);
  });

  test("a file over the limit yields one violation pointing at the first extra line", () => {
    const v = findViolations("a\nb\nc\nd\n", 3);
    expect(v).toHaveLength(1);
    expect(v[0]).toMatchObject({ line: 4, col: 1, kind: "max-file-lines" });
    expect(v[0].detail).toBe("file has 4 lines (limit 3)");
  });

  test("defaults to the exported MAX_FILE_LINES limit", () => {
    const src = "x\n".repeat(MAX_FILE_LINES + 1);
    expect(findViolations(src)).toHaveLength(1);
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

  const oversized = () => "x\n".repeat(MAX_FILE_LINES + 1);

  test("unknown mode prints usage and exits 2", async () => {
    await expect(main(["node", "s.mjs", "--bogus"])).rejects.toThrow(/__exit__:2/);
    expect(io.text(io.stderrSpy)).toMatch(/Usage:/);
  });

  test("--files on a file within the limit resolves without exit", async () => {
    const repo = await makeTempGitRepo("mfl-clean-");
    const p = join(repo, "ok.ts");
    await writeFile(p, "export const x = 1;\n", "utf8");
    process.chdir(repo);
    await main(["node", "s.mjs", "--files", p]);
    expect(io.exitSpy).not.toHaveBeenCalled();
    await cleanupTmp(repo);
  });

  test("--files on an oversized file writes the violation and exits 1", async () => {
    const repo = await makeTempGitRepo("mfl-dirty-");
    const p = join(repo, "big.ts");
    await writeFile(p, oversized(), "utf8");
    process.chdir(repo);
    await expect(main(["node", "s.mjs", "--files", p])).rejects.toThrow(/__exit__:1/);
    expect(io.text(io.stderrSpy)).toMatch(/max-file-lines/);
    await cleanupTmp(repo);
  });

  test("--files skips non-lintable paths (collect returns [])", async () => {
    const repo = await makeTempGitRepo("mfl-skip-");
    const p = join(repo, "big.txt");
    await writeFile(p, oversized(), "utf8");
    process.chdir(repo);
    await main(["node", "s.mjs", "--files", p]);
    expect(io.exitSpy).not.toHaveBeenCalled();
    await cleanupTmp(repo);
  });

  test("--staged clean repo prints the staged-diff OK line", async () => {
    const repo = await makeTempGitRepo("mfl-staged-");
    await writeFile(join(repo, "ok.ts"), "export const x = 1;\n", "utf8");
    await commitAllIn(repo, "seed");
    process.chdir(repo);
    await main(["node", "s.mjs", "--staged"]);
    expect(io.exitSpy).not.toHaveBeenCalled();
    expect(io.text(io.stdoutSpy)).toMatch(/no oversized files/);
    await cleanupTmp(repo);
  });

  test("--all oversized repo flags the violation and exits 1", async () => {
    const repo = await makeTempGitRepo("mfl-all-");
    await writeFile(join(repo, "big.ts"), oversized(), "utf8");
    await commitAllIn(repo, "seed");
    process.chdir(repo);
    await expect(main(["node", "s.mjs", "--all"])).rejects.toThrow(/__exit__:1/);
    expect(io.text(io.stderrSpy)).toMatch(/max-file-lines/);
    await cleanupTmp(repo);
  });

  test("--warn downgrades a violation to advisory (no exit)", async () => {
    const repo = await makeTempGitRepo("mfl-warn-");
    const p = join(repo, "big.ts");
    await writeFile(p, oversized(), "utf8");
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
    tmpRoot = await mkdtemp(join(tmpdir(), "mfl-file-"));
  });
  afterEach(async () => {
    await cleanupTmp(tmpRoot);
  });

  test("tags a violation with the given path", async () => {
    const p = join(tmpRoot, "big.ts");
    await writeFile(p, "x\n".repeat(MAX_FILE_LINES + 1), "utf8");
    const v = await lintFile(p);
    expect(v).toHaveLength(1);
    expect(v[0].path).toBe(p);
  });
});
