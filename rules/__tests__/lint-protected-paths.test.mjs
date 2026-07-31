import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main } from "../lint-protected-paths/check.mjs";
import { cleanupTmp, commitAllIn, makeTempGitRepo } from "./test-helpers.mjs";

// Injected loader: the DB read + real glob match are covered in
// src/rules/protectedPaths.ts; here we only exercise the git-hook flow.
const load = async () => ({
  globs: ["schema.sql"],
  match: (path) => path.endsWith("schema.sql"),
});

describe("lint-protected-paths main", () => {
  let tmpRoot;
  let origCwd;
  let exitSpy;
  let stderrSpy;
  let stdoutSpy;

  beforeEach(async () => {
    tmpRoot = await mkdtemp(join(tmpdir(), "lpp-main-"));
    origCwd = process.cwd();
    exitSpy = vi.spyOn(process, "exit").mockImplementation((code) => {
      throw new Error(`__exit__:${code}`);
    });
    stderrSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    stdoutSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);
  });

  afterEach(async () => {
    process.chdir(origCwd);
    exitSpy.mockRestore();
    stderrSpy.mockRestore();
    stdoutSpy.mockRestore();
    await cleanupTmp(tmpRoot);
  });

  const stderrText = () => stderrSpy.mock.calls.map((c) => c[0]).join("");
  const stdoutText = () => stdoutSpy.mock.calls.map((c) => c[0]).join("");

  test("no/unknown mode prints usage and exits 2", async () => {
    await expect(main(["node", "s.mjs"], load)).rejects.toThrow(/__exit__:2/);
    expect(stderrText()).toMatch(/Usage:/);
  });

  test("--files with a non-protected file resolves without exit", async () => {
    const ok = join(tmpRoot, "index.ts");
    await writeFile(ok, "export const x = 1;\n", "utf8");
    await main(["node", "s.mjs", "--files", ok], load);
    expect(exitSpy).not.toHaveBeenCalled();
  });

  test("--files with a protected file writes a violation and exits 1", async () => {
    const bad = join(tmpRoot, "schema.sql");
    await writeFile(bad, "CREATE TABLE x (id INTEGER);\n", "utf8");
    await expect(main(["node", "s.mjs", "--files", bad], load)).rejects.toThrow(
      /__exit__:1/,
    );
    expect(stderrText()).toContain("protected path");
    expect(stderrText()).toMatch(/1 protected path\(s\)/);
  });

  test("--staged over a clean repo prints the OK line", async () => {
    const repo = await makeTempGitRepo("lpp-staged-");
    await writeFile(join(repo, "index.ts"), "export const x = 1;\n", "utf8");
    await commitAllIn(repo, "seed");
    process.chdir(repo);
    await main(["node", "s.mjs", "--staged"], load);
    expect(exitSpy).not.toHaveBeenCalled();
    expect(stdoutText()).toMatch(/no protected paths in changeset/);
    await cleanupTmp(repo);
  });

  test("--all over a repo containing a protected path exits 1", async () => {
    const repo = await makeTempGitRepo("lpp-all-");
    await writeFile(
      join(repo, "schema.sql"),
      "CREATE TABLE x (id INTEGER);\n",
      "utf8",
    );
    await commitAllIn(repo, "seed");
    process.chdir(repo);
    await expect(main(["node", "s.mjs", "--all"], load)).rejects.toThrow(
      /__exit__:1/,
    );
    expect(stderrText()).toContain("protected path");
    await cleanupTmp(repo);
  });

  test("--all with CO_JSON emits one JSON line and never exits", async () => {
    const repo = await makeTempGitRepo("lpp-json-");
    await writeFile(
      join(repo, "schema.sql"),
      "CREATE TABLE x (id INTEGER);\n",
      "utf8",
    );
    await commitAllIn(repo, "seed");
    process.chdir(repo);
    process.env.CO_JSON = "1";
    try {
      await main(["node", "s.mjs", "--all"], load);
    } finally {
      delete process.env.CO_JSON;
    }
    expect(exitSpy).not.toHaveBeenCalled();
    const lines = stdoutText().split("\n").filter(Boolean);
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]).violations.length).toBeGreaterThan(0);
    await cleanupTmp(repo);
  });
});
