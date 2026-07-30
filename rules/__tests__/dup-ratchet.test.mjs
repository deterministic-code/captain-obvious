import { describe, expect, test } from "vitest";
import {
  parseAddedLineRanges,
  pushRatchetInputs,
  rangesOverlap,
} from "../_kit/dup-ratchet.mjs";

describe("dup-ratchet / parseAddedLineRanges", () => {
  test("hunk with a count yields the inclusive added range", () => {
    const diff = `@@ -3,0 +4,2 @@\n+added one\n+added two\n`;
    expect(parseAddedLineRanges(diff)).toEqual([[4, 5]]);
  });

  test("hunk with no count defaults to a single line", () => {
    const diff = `@@ -1 +1 @@\n-old\n+new\n`;
    expect(parseAddedLineRanges(diff)).toEqual([[1, 1]]);
  });

  test("pure-deletion hunk with +count 0 contributes no range", () => {
    const diff = `@@ -5,3 +4,0 @@\n-gone one\n-gone two\n-gone three\n`;
    expect(parseAddedLineRanges(diff)).toEqual([]);
  });

  test("multiple hunks accumulate their ranges", () => {
    const diff = `@@ -3,0 +4,2 @@\n+a\n+b\n@@ -10,0 +12,1 @@\n+c\n`;
    expect(parseAddedLineRanges(diff)).toEqual([
      [4, 5],
      [12, 12],
    ]);
  });

  test("non-hunk lines are ignored", () => {
    const diff = `diff --git a/x b/x\nindex 111..222 100644\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n+changed\n`;
    expect(parseAddedLineRanges(diff)).toEqual([[1, 1]]);
  });

  test("empty diff yields no ranges", () => {
    expect(parseAddedLineRanges("")).toEqual([]);
  });
});

describe("dup-ratchet / rangesOverlap", () => {
  test("overlapping ranges return true", () => {
    expect(rangesOverlap([4, 8], [[6, 10]])).toBe(true);
  });

  test("touching at the boundary counts as overlap", () => {
    expect(rangesOverlap([4, 6], [[6, 10]])).toBe(true);
  });

  test("fully-inside range returns true", () => {
    expect(rangesOverlap([7, 8], [[6, 10]])).toBe(true);
  });

  test("disjoint-before returns false", () => {
    expect(rangesOverlap([1, 3], [[6, 10]])).toBe(false);
  });

  test("disjoint-after returns false", () => {
    expect(rangesOverlap([11, 14], [[6, 10]])).toBe(false);
  });

  test("empty ranges array returns false", () => {
    expect(rangesOverlap([4, 8], [])).toBe(false);
  });
});

describe("dup-ratchet / pushBase error handling", () => {
  // A git spawn failure carries a `.stderr` ("" at minimum), so pushBase's
  // classify regex sees an empty message and can't match "origin/main absent" —
  // the error rethrows rather than being swallowed as a missing-ref skip.
  test("pushRatchetInputs rethrows a git spawn error rather than skipping", async () => {
    const savedPath = process.env.PATH;
    process.env.PATH = "";
    try {
      await expect(pushRatchetInputs("/nonexistent-repo", "t")).rejects.toThrow(
        /ENOENT|spawn/,
      );
    } finally {
      process.env.PATH = savedPath;
    }
  });
});
