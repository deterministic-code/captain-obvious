import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  cleanupTmp,
  commitAllIn,
  makeTempGitRepo,
  markCurrentAsOriginMain,
  mockProcessIo,
} from "./test-helpers.mjs";

// These cover two defensive arms that the normal data flow can't reach:
//   - `addedRanges.get(path) ?? []` when a target is absent from the ranges map
//     (collectAddedRanges always keys every target, so we stub it to drop one).
//   - `toRepoRelative`'s non-absolute branch in runAllMode (subtreesForFile always
//     yields resolved absolute paths, so we stub it to hand back a relative one).
vi.mock("../_kit/dup-ratchet.mjs", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, collectAddedRanges: vi.fn(async () => new Map()) };
});

vi.mock("../_kit/dup-structural-metrics.mjs", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    tableViolationsForFile: vi.fn(async () => [
      {
        line: 3,
        col: 1,
        kind: "structural sibling duplication (3 entries)",
        detail: "x",
      },
    ]),
    subtreesForFile: vi.fn(async () => ({
      path: "relative/mod.mjs",
      subtrees: [
        {
          fp: "(Obj shared)",
          name: "a",
          kind: "ObjectLiteralExpression",
          start: 1,
          end: 4,
          nodeCount: 25,
        },
      ],
    })),
    cloneClusters: vi.fn(() => [
      [
        { path: "relative/mod.mjs", start: 1, end: 4, nodeCount: 25 },
        { path: "relative/other.mjs", start: 6, end: 9, nodeCount: 25 },
      ],
    ]),
  };
});

const { main } = await import("../lint-dup-structural/check.mjs");

describe("lint-dup-structural / defensive branches", () => {
  let repo;
  let io;
  let cwd;

  beforeEach(async () => {
    repo = await makeTempGitRepo("lint-dup-structural-defensive-");
    cwd = process.cwd();
    process.chdir(repo);
    io = mockProcessIo();
  });

  afterEach(async () => {
    io.restore();
    process.chdir(cwd);
    await cleanupTmp(repo);
  });

  // With collectAddedRanges stubbed to an empty map, the per-target lookup hits
  // the `?? []` fallback; an empty added-range list overlaps nothing, so no
  // violation is recorded and the push passes.
  test("--push with a target missing from the added-ranges map records no violation", async () => {
    const { writeFile } = await import("node:fs/promises");
    const { join } = await import("node:path");
    await writeFile(join(repo, "unrelated.mjs"), `export const v = "1";\n`);
    await commitAllIn(repo, "baseline");
    await markCurrentAsOriginMain(repo);
    await writeFile(join(repo, "conv.mjs"), `export const CONV = { a: 1 };\n`);
    await commitAllIn(repo, "add a structural file");

    await main(["node", "s", "--push"]);
    expect(io.exitSpy).not.toHaveBeenCalled();
    expect(io.text(io.stdoutSpy)).toContain("no newly-introduced sibling");
  });

  // A relative clone-member path exercises toRepoRelative's `: name` branch.
  test("--all renders a relative clone-member path unchanged (non-absolute branch)", async () => {
    const { writeFile } = await import("node:fs/promises");
    const { join } = await import("node:path");
    await writeFile(join(repo, "conv.mjs"), `export const CONV = { a: 1 };\n`);
    await commitAllIn(repo, "a structural file");

    await main(["node", "s", "--all"]);
    expect(io.exitSpy).not.toHaveBeenCalled();
    const out = io.text(io.stdoutSpy);
    expect(out).toContain("relative/mod.mjs:1-4");
    expect(out).toContain("relative/other.mjs:6-9");
  });
});
