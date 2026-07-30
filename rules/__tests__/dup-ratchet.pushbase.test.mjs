import { describe, expect, test, vi } from "vitest";

// Mock execFile so its callback rejects with a bare Error that has NO `.stderr`
// property. This is the only way pushBase's `err.stderr ?? ""` reaches the `""`
// fallback: a real execFile rejection always attaches `.stderr` (empty at worst),
// but the defensive coalesce must still classify a stderr-less error as unknown
// and rethrow it rather than treat it as an absent origin/main.
vi.mock("node:child_process", () => ({
  execFile: (_cmd, _args, _opts, cb) => {
    const err = new Error("boom-no-stderr");
    cb(err, "", undefined);
  },
}));

const { pushRatchetInputs } = await import("../_kit/dup-ratchet.mjs");

describe("dup-ratchet / pushBase coalesces a stderr-less error", () => {
  test("rethrows an error whose stderr is undefined (?? \"\" fallback)", async () => {
    await expect(pushRatchetInputs("/repo", "t")).rejects.toThrow(
      /boom-no-stderr/,
    );
  });
});
