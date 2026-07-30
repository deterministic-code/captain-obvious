import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { main } from "../lint-dup-structural/check.mjs";
import {
  cleanupTmp,
  commitAllIn,
  gitIn,
  makeTempGitRepo,
  markCurrentAsOriginMain,
  mockProcessIo,
} from "./test-helpers.mjs";

const REGEX_TABLE = `export const CONV = {
  typescript: { prunePattern: /^[A-Za-z]+\\.ts$/, ext: ".ts" },
  rust: { prunePattern: /^[A-Za-z_]+\\.rs$/, ext: ".rs" },
  python: { prunePattern: /^[A-Za-z_]+\\.py$/, ext: ".py" },
};
`;

// Two files carrying an identical above-floor object literal → a clone cluster
// that --all reports in addition to the sibling table.
const CLONE_OBJECT = `export const shape = {
  alpha: { one: 1, two: 2, three: 3, four: 4 },
  beta: { five: 5, six: 6, seven: 7, eight: 8 },
  gamma: { nine: 9, ten: 10, eleven: 11, twelve: 12 },
};
`;

describe("lint-dup-structural / main dispatch (in-process)", () => {
  let repo;
  let io;
  let cwd;

  beforeEach(async () => {
    repo = await makeTempGitRepo("lint-dup-structural-modes-");
    cwd = process.cwd();
    process.chdir(repo);
    io = mockProcessIo();
  });

  afterEach(async () => {
    io.restore();
    process.chdir(cwd);
    await cleanupTmp(repo);
  });

  test("--staged flags a newly-staged sibling table and exits 1", async () => {
    await writeFile(join(repo, "conv.mjs"), REGEX_TABLE);
    await gitIn(repo, ["add", "-A"]);

    await expect(main(["node", "s", "--staged"])).rejects.toThrow(
      /__exit__:1/,
    );
    expect(io.text(io.stderrSpy)).toContain(
      "newly-introduced sibling-duplication",
    );
  });

  test("--staged over a clean staged diff prints the OK line", async () => {
    await writeFile(join(repo, "plain.mjs"), `export const x = 1;\n`);
    await gitIn(repo, ["add", "-A"]);
    await main(["node", "s", "--staged"]);
    expect(io.exitSpy).not.toHaveBeenCalled();
    expect(io.text(io.stdoutSpy)).toContain(
      "no newly-introduced sibling duplication",
    );
  });

  test("--staged with no structural files prints the no-code-files line", async () => {
    await writeFile(join(repo, "readme.md"), "# hi\n");
    await gitIn(repo, ["add", "-A"]);
    await main(["node", "s", "--staged"]);
    expect(io.text(io.stdoutSpy)).toContain("no");
    expect(io.text(io.stdoutSpy)).toContain("code files");
  });

  test("--all reports both a sibling table and a clone cluster, report-only", async () => {
    await writeFile(join(repo, "conv.mjs"), REGEX_TABLE);
    await writeFile(join(repo, "shapeA.mjs"), CLONE_OBJECT);
    await writeFile(
      join(repo, "shapeB.mjs"),
      CLONE_OBJECT.replace("shape", "otherShape"),
    );
    await commitAllIn(repo, "tables + clones");

    await main(["node", "s", "--all"]);
    expect(io.exitSpy).not.toHaveBeenCalled();
    const out = io.text(io.stdoutSpy);
    expect(out).toContain("structural sibling duplication");
    expect(out).toContain("clone cluster");
    expect(out).toMatch(/sibling table\(s\), \d+ clone cluster\(s\)/);
  });

  test("--all with CO_JSON emits one JSON line with table + cluster violations", async () => {
    await writeFile(join(repo, "conv.mjs"), REGEX_TABLE);
    await writeFile(join(repo, "shapeA.mjs"), CLONE_OBJECT);
    await writeFile(
      join(repo, "shapeB.mjs"),
      CLONE_OBJECT.replace("shape", "otherShape"),
    );
    await commitAllIn(repo, "tables + clones");

    process.env.CO_JSON = "1";
    try {
      await main(["node", "s", "--all"]);
    } finally {
      delete process.env.CO_JSON;
    }
    expect(io.exitSpy).not.toHaveBeenCalled();
    const lines = io.text(io.stdoutSpy).split("\n").filter(Boolean);
    expect(lines).toHaveLength(1);
    const violations = JSON.parse(lines[0]).violations;
    expect(violations.some((v) => v.kind.startsWith("clone cluster"))).toBe(true);
  });

  test("--files with a table in a listed file writes to stderr and exits 1", async () => {
    await writeFile(join(repo, "conv.mjs"), REGEX_TABLE);
    await commitAllIn(repo, "table");

    await expect(
      main(["node", "s", "--files", "conv.mjs"]),
    ).rejects.toThrow(/__exit__:1/);
    expect(io.text(io.stderrSpy)).toContain("conv.mjs");
    expect(io.text(io.stderrSpy)).toContain("structural sibling duplication");
  });

  test("--files with no violation in the listed file prints the clean line", async () => {
    await writeFile(join(repo, "plain.mjs"), `export const x = 1;\n`);
    await commitAllIn(repo, "plain");

    await main(["node", "s", "--files", "plain.mjs"]);
    expect(io.exitSpy).not.toHaveBeenCalled();
    expect(io.text(io.stdoutSpy)).toContain("no violations in the given files");
  });

  test("--files with only non-structural paths prints the no-code-files line", async () => {
    await writeFile(join(repo, "readme.md"), "# hi\n");
    await commitAllIn(repo, "docs");

    await main(["node", "s", "--files", "readme.md"]);
    expect(io.text(io.stdoutSpy)).toContain("no code files given");
  });

  // An excluded path (e.g. under dist/) is filtered by isStructuralFile → isExcluded,
  // so a .mjs there is not a candidate despite the JS extension.
  test("--files excludes paths under an EXCLUDED_PATH_PARTS dir (dist/)", async () => {
    await main(["node", "s", "--files", "dist/bundle.mjs"]);
    expect(io.text(io.stdoutSpy)).toContain("no code files given");
  });

  test("no mode prints usage and exits 2", async () => {
    await expect(main(["node", "s"])).rejects.toThrow(/__exit__:2/);
    expect(io.text(io.stderrSpy)).toContain("Usage:");
  });

  test("--push skips when origin/main is absent", async () => {
    await writeFile(join(repo, "conv.mjs"), REGEX_TABLE);
    await commitAllIn(repo, "table but no origin ref");
    await main(["node", "s", "--push"]);
    expect(io.exitSpy).not.toHaveBeenCalled();
    expect(io.text(io.stdoutSpy)).toContain("origin/main not found");
  });

  test("--push flags a newly-introduced table (exercises ratchetViolations path)", async () => {
    await writeFile(join(repo, "unrelated.mjs"), `export const v = "1";\n`);
    await commitAllIn(repo, "baseline");
    await markCurrentAsOriginMain(repo);
    await writeFile(join(repo, "conv.mjs"), REGEX_TABLE);
    await commitAllIn(repo, "add table");

    await expect(main(["node", "s", "--push"])).rejects.toThrow(/__exit__:1/);
    expect(io.text(io.stderrSpy)).toContain("conv.mjs");
  });

  test("--push --warn on a newly-introduced table prints the advisory and exits 0", async () => {
    await writeFile(join(repo, "unrelated.mjs"), `export const v = "1";\n`);
    await commitAllIn(repo, "baseline");
    await markCurrentAsOriginMain(repo);
    await writeFile(join(repo, "conv.mjs"), REGEX_TABLE);
    await commitAllIn(repo, "add table");

    await main(["node", "s", "--push", "--warn"]);
    expect(io.exitSpy).not.toHaveBeenCalled();
    expect(io.text(io.stderrSpy)).toContain("⚠ lint-dup-structural");
    expect(io.text(io.stderrSpy)).toContain("advisory");
  });
});
