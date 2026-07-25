import { describe, expect, test } from "vitest";
import { knipIssuesToViolations } from "../lint-dead-code.mjs";

describe("lint-dead-code / knipIssuesToViolations", () => {
  test("a nonempty files entry yields one unused-file violation at line 1", () => {
    const issues = [
      {
        file: "scripts/foo.mjs",
        files: [{ name: "scripts/foo.mjs" }],
      },
    ];
    expect(knipIssuesToViolations(issues)).toEqual([
      {
        path: "scripts/foo.mjs",
        line: 1,
        col: 1,
        kind: "unused file",
        detail:
          "no other module imports this file. Delete it, or add its entrypoint to knip.json if it is reached dynamically.",
      },
    ]);
  });

  test("exports and types entries yield per-entry violations with kind, path, line, col", () => {
    const issues = [
      {
        file: "scripts/bar.mjs",
        exports: [{ name: "parseX", line: 86, col: 17, pos: 2607 }],
        types: [{ name: "EdgeKind", line: 58, col: 13, pos: 900 }],
      },
    ];
    const detail =
      "nothing imports this export. Remove it, or if it is consumed dynamically (string-keyed dispatch), add the referencing entry to knip.json.";
    expect(knipIssuesToViolations(issues)).toEqual([
      {
        path: "scripts/bar.mjs",
        line: 86,
        col: 17,
        kind: "unused export `parseX`",
        detail,
      },
      {
        path: "scripts/bar.mjs",
        line: 58,
        col: 13,
        kind: "unused type `EdgeKind`",
        detail,
      },
    ]);
  });

  test("enumMembers object-of-arrays flattens into per-member violations", () => {
    const issues = [
      {
        file: "scripts/baz.mjs",
        enumMembers: {
          SomeEnum: [
            { name: "A", line: 5, col: 3 },
            { name: "B", line: 6, col: 3 },
          ],
          Other: [{ name: "C", line: 20, col: 7 }],
        },
      },
    ];
    expect(knipIssuesToViolations(issues).map((v) => v.kind)).toEqual([
      "unused enum member `A`",
      "unused enum member `B`",
      "unused enum member `C`",
    ]);
    expect(knipIssuesToViolations(issues)[0]).toMatchObject({
      path: "scripts/baz.mjs",
      line: 5,
      col: 3,
    });
  });

  test("an empty issues array yields no violations", () => {
    expect(knipIssuesToViolations([])).toEqual([]);
  });

  test("an issue with all groups empty or absent yields no violations", () => {
    const issues = [
      { file: "scripts/qux.mjs", files: [], exports: [], types: [] },
      { file: "scripts/quux.mjs" },
    ];
    expect(knipIssuesToViolations(issues)).toEqual([]);
  });
});
