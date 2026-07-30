import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { findRegressions, main } from "../lint-coverage/check.mjs";
import { repoRootOf } from "../_kit/lint-shared.mjs";
import { cleanupTmp, makeTempGitRepo, mockProcessIo } from "./test-helpers.mjs";

const METRICS = ["lines", "statements", "functions", "branches"];

/** A coverage-summary entry (raw json-summary shape) with one pct per metric. */
function entry(pct) {
  const e = {};
  for (const m of METRICS) e[m] = { pct };
  return e;
}

/** The reduced `{ metric: pct }` shape findRegressions consumes (post readSummary). */
function nums(pct) {
  const e = {};
  for (const m of METRICS) e[m] = pct;
  return e;
}

describe("findRegressions", () => {
  test("flags every total metric that dropped below baseline", () => {
    const r = findRegressions({ total: nums(90) }, { total: nums(85), files: {} });
    expect(r).toHaveLength(METRICS.length);
    expect(r[0]).toMatchObject({ scope: "total", metric: "lines", baseline: 90, current: 85 });
  });

  test("flags a per-file drop and skips a baselined file absent from the run", () => {
    const base = {
      total: nums(90),
      files: { "src/a.ts": nums(80), "src/gone.ts": nums(70) },
    };
    const current = { total: nums(90), files: { "src/a.ts": nums(75) } };
    const scopes = new Set(findRegressions(base, current).map((x) => x.scope));
    expect(scopes).toEqual(new Set(["src/a.ts"]));
  });

  test("no regression when coverage holds, improves, or dips within epsilon", () => {
    expect(findRegressions({ total: nums(90) }, { total: nums(90), files: {} })).toEqual([]);
    expect(findRegressions({ total: nums(90) }, { total: nums(95), files: {} })).toEqual([]);
    expect(findRegressions({ total: nums(90) }, { total: nums(89.995), files: {} })).toEqual([]);
  });
});

describe("lint-coverage / main", () => {
  let repo, root, io, origCwd;

  async function writeSummary(obj) {
    await mkdir(join(repo, "coverage"), { recursive: true });
    await writeFile(
      join(repo, "coverage", "coverage-summary.json"),
      JSON.stringify(obj),
      "utf8",
    );
  }

  beforeEach(async () => {
    repo = await makeTempGitRepo("cov-");
    root = await repoRootOf(repo);
    origCwd = process.cwd();
    process.chdir(repo);
    io = mockProcessIo();
  });

  afterEach(async () => {
    io.restore();
    process.chdir(origCwd);
    await cleanupTmp(repo);
  });

  test("unknown mode prints usage and exits 2", async () => {
    await expect(main(["node", "s", "--bogus"])).rejects.toThrow(/__exit__:2/);
    expect(io.text(io.stderrSpy)).toMatch(/Usage:/);
  });

  test("check mode with no baseline prints a hint and does not fail", async () => {
    await main(["node", "s", "--push"]);
    expect(io.exitSpy).not.toHaveBeenCalled();
    expect(io.text(io.stdoutSpy)).toMatch(/no coverage-baseline\.json/);
  });

  test("--update writes the baseline from the current summary", async () => {
    await writeSummary({ total: entry(90), [join(root, "src/a.ts")]: entry(80) });
    await main(["node", "s", "--update"]);
    const written = JSON.parse(
      await readFile(join(repo, "coverage-baseline.json"), "utf8"),
    );
    expect(written.total.lines).toBe(90);
    expect(written.files["src/a.ts"].lines).toBe(80);
    expect(io.text(io.stdoutSpy)).toMatch(/baseline updated/);
  });

  test("--add is an alias for --update", async () => {
    await writeSummary({ total: entry(90) });
    await main(["node", "s", "--add"]);
    expect(io.text(io.stdoutSpy)).toMatch(/baseline updated/);
  });

  test("passes when coverage holds against the baseline", async () => {
    await writeSummary({ total: entry(90), [join(root, "src/a.ts")]: entry(80) });
    await main(["node", "s", "--update"]);
    io.stdoutSpy.mockClear();
    await main(["node", "s", "--push"]);
    expect(io.exitSpy).not.toHaveBeenCalled();
    expect(io.text(io.stdoutSpy)).toMatch(/no coverage regressions/);
  });

  test("fails and exits 1 when coverage regresses", async () => {
    await writeSummary({ total: entry(90) });
    await main(["node", "s", "--update"]);
    await writeSummary({ total: entry(80) });
    await expect(main(["node", "s", "--push"])).rejects.toThrow(/__exit__:1/);
    expect(io.text(io.stderrSpy)).toMatch(
      /coverage regressed: total lines 80\.00% < baseline 90\.00%/,
    );
  });

  test("--warn downgrades a regression to advisory (no exit)", async () => {
    await writeSummary({ total: entry(90) });
    await main(["node", "s", "--update"]);
    await writeSummary({ total: entry(80) });
    await main(["node", "s", "--push", "--warn"]);
    expect(io.exitSpy).not.toHaveBeenCalled();
    expect(io.text(io.stderrSpy)).toMatch(/coverage regressed/);
  });

  test("throws a clear error when the summary is missing", async () => {
    await writeSummary({ total: entry(90) });
    await main(["node", "s", "--update"]);
    await rm(join(repo, "coverage"), { recursive: true, force: true });
    await expect(main(["node", "s", "--push"])).rejects.toThrow(/not found/);
  });
});
