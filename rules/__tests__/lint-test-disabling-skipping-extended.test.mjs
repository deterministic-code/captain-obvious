import { describe, expect, test } from "vitest";
import {
  diffMarkers,
  findViolations,
} from "../lint-test-disabling-skipping/check.mjs";

describe("extended suppression markers (absolute scan)", () => {
  test("flags fdescribe / fit focus aliases", () => {
    expect(
      findViolations("fdescribe('s', () => {});\n", "unit").map((v) => v.kind),
    ).toContain("focus-alias");
    expect(
      findViolations("fit('t', () => {});\n", "unit").map((v) => v.kind),
    ).toContain("focus-alias");
  });

  test("flags .todo", () => {
    expect(
      findViolations("it.todo('later');\n", "unit").map((v) => v.kind),
    ).toContain("todo");
  });

  test("flags this.skip()", () => {
    expect(
      findViolations("it('x', function () { this.skip(); });\n", "unit").map(
        (v) => v.kind,
      ),
    ).toContain("this-skip");
  });

  test("does not flag legitimate identifiers (benefit, todos)", () => {
    const kinds = findViolations(
      "const benefit = 1; const todos = [];\n",
      "unit",
    ).map((v) => v.kind);
    expect(kinds).not.toContain("focus-alias");
    expect(kinds).not.toContain("todo");
  });
});

describe("extended markers count as ratchet regressions", () => {
  test("adding fit / .todo / this.skip to a file is a regression", () => {
    const before = "it('x', () => { expect(1).toBe(1); });\n";
    const after =
      "fit('x', () => { expect(1).toBe(1); });\nit.todo('y');\nit('z', function () { this.skip(); });\n";
    const ids = diffMarkers(before, after).map((r) => r.id);
    expect(ids).toEqual(
      expect.arrayContaining(["focus-alias", "todo", "this-skip"]),
    );
  });
});
