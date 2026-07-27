import { describe, expect, it } from "vitest";
import { renderHook } from "../git-hooks.mjs";

describe("renderHook", () => {
  it("dispatches the named stage through dispatch.mjs and fails on non-zero", () => {
    const script = renderHook("pre-commit", "hooks/git", []);
    expect(script).toContain(
      'node "$ROOT/hooks/git/dispatch.mjs" pre-commit || exit 1',
    );
    expect(script.startsWith("#!/bin/sh\n")).toBe(true);
  });

  it("passes the stage name straight through (pre-push)", () => {
    expect(renderHook("pre-push", "hooks/git", [])).toContain(
      'dispatch.mjs" pre-push || exit 1',
    );
  });

  it("appends run: passthroughs after the dispatch line, each blocking", () => {
    const script = renderHook("pre-push", "hooks/git", ["npm run test:unit"]);
    const lines = script.trim().split("\n");
    expect(lines.at(-2)).toBe('node "$ROOT/hooks/git/dispatch.mjs" pre-push || exit 1');
    expect(lines.at(-1)).toBe("npm run test:unit || exit 1");
  });
});
