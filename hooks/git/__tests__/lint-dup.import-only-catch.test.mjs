import { describe, expect, test, vi } from "vitest";

// isImportOnlyBlock reads the clone's file to decide whether the block is
// import-only; if that read fails (the file left the diff mid-run) it must
// treat the block as non-import (catch → null → false) and still record the
// violation, not crash. Mock readFile to reject so that catch arm is exercised.
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    readFile: vi.fn(() => Promise.reject(new Error("gone mid-run"))),
  };
});

const { selectNewClones } = await import("../lint-dup.mjs");

describe("lint-dup / isImportOnlyBlock read-failure fallback", () => {
  test("a clone whose file can't be read is still reported (catch → false)", async () => {
    const duplicates = [
      {
        lines: 6,
        firstFile: { name: "a.ts", start: 10, end: 15 },
        secondFile: { name: "b.ts", start: 40, end: 45 },
      },
    ];
    const added = new Map([["a.ts", [[12, 20]]]]);
    const violations = await selectNewClones(duplicates, added, "/repo");
    expect(violations).toHaveLength(1);
    expect(violations[0].path).toBe("a.ts");
  });
});
