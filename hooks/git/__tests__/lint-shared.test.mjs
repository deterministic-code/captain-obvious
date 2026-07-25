import { afterEach, describe, expect, test, vi } from "vitest";
import { runFileHook } from "../lint-shared.mjs";

const VIOLATION = {
  path: "a.ts",
  line: 1,
  col: 1,
  kind: "isp",
  detail: "boom",
};

const opts = (collect) => ({
  usage: () => {},
  collect,
  okLine: "OK",
  summary: (n) => `SOLID-X: ${n} violation(s).`,
});

const spy = () => {
  const err = [];
  const exit = vi.spyOn(process, "exit").mockImplementation(() => {});
  const write = vi.spyOn(process.stderr, "write").mockImplementation((s) => {
    err.push(s);
    return true;
  });
  return { err, exit, write };
};

afterEach(() => vi.restoreAllMocks());

describe("runFileHook / --warn downgrades violations to advisory", () => {
  test("with --warn, a violation prints but does not exit non-zero", async () => {
    const { err, exit } = spy();
    await runFileHook(
      ["node", "hook", "--files", "a.ts", "--warn"],
      opts(() => [VIOLATION]),
    );
    expect(exit).not.toHaveBeenCalled();
    expect(err.join("")).toContain("advisory");
    expect(err.join("")).toContain("boom");
  });

  test("--warn is stripped before file selection (not treated as a path)", async () => {
    const seen = [];
    await runFileHook(
      ["node", "hook", "--files", "a.ts", "--warn"],
      opts((path) => {
        seen.push(path);
        return [];
      }),
    );
    expect(seen).toEqual(["a.ts"]);
  });

  test("without --warn, a violation exits 1 (still blocking)", async () => {
    const { exit } = spy();
    await runFileHook(
      ["node", "hook", "--files", "a.ts"],
      opts(() => [VIOLATION]),
    );
    expect(exit).toHaveBeenCalledWith(1);
  });

  test("a clean run never exits, warn or not", async () => {
    const { exit } = spy();
    await runFileHook(
      ["node", "hook", "--files", "a.ts", "--warn"],
      opts(() => []),
    );
    await runFileHook(
      ["node", "hook", "--files", "a.ts"],
      opts(() => []),
    );
    expect(exit).not.toHaveBeenCalled();
  });
});
