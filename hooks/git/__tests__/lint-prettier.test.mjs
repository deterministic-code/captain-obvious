import { describe, expect, test } from "vitest";
import { parsePrettierCheckOutput, selectMode } from "../lint-prettier.mjs";

describe("lint-prettier / selectMode", () => {
  test("--staged is a check over the staged selection", () => {
    expect(selectMode(["--staged"])).toEqual({
      op: "check",
      selector: "--staged",
      warn: false,
      files: [],
    });
  });

  test("--all is a check over all files", () => {
    expect(selectMode(["--all"])).toMatchObject({ op: "check", selector: "--all" });
  });

  test("--files keeps the trailing paths", () => {
    expect(selectMode(["--files", "a.ts", "b.tsx"])).toEqual({
      op: "check",
      selector: "--files",
      warn: false,
      files: ["a.ts", "b.tsx"],
    });
  });

  test("--warn marks the check advisory", () => {
    expect(selectMode(["--staged", "--warn"])).toMatchObject({
      op: "check",
      warn: true,
    });
  });

  test("--fix alone defaults to the staged selection", () => {
    expect(selectMode(["--fix"])).toMatchObject({ op: "fix", selector: "--staged" });
  });

  test("--fix combines with a selector", () => {
    expect(selectMode(["--fix", "--all"])).toMatchObject({
      op: "fix",
      selector: "--all",
    });
    expect(selectMode(["--fix", "--files", "a.ts"])).toEqual({
      op: "fix",
      selector: "--files",
      warn: false,
      files: ["a.ts"],
    });
  });

  test("an unknown selector is rejected", () => {
    expect(selectMode(["--bogus"])).toBeNull();
    expect(selectMode([])).toBeNull();
  });
});

describe("lint-prettier / parsePrettierCheckOutput", () => {
  test("one violation per [warn] file line", () => {
    const out = "[warn] src/a.ts\n[warn] src/b.tsx\n";
    const v = parsePrettierCheckOutput(out);
    expect(v).toHaveLength(2);
    expect(v[0]).toMatchObject({
      path: "src/a.ts",
      line: 1,
      col: 1,
      kind: "not prettier-formatted",
    });
    expect(v[1].path).toBe("src/b.tsx");
  });

  test("clean output yields no violations", () => {
    expect(parsePrettierCheckOutput("All matched files use Prettier code style!\n")).toEqual(
      [],
    );
  });

  test("the summary [warn] line is not mistaken for a file", () => {
    const out = "[warn] src/a.ts\n[warn] Code style issues found in the above file. Run Prettier with --write to fix.\n";
    const v = parsePrettierCheckOutput(out);
    expect(v).toHaveLength(1);
    expect(v[0].path).toBe("src/a.ts");
  });
});
