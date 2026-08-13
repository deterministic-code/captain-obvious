import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { checkScriptPath } from "../runner.js";
import { RULES } from "../index.js";
import type { Stage } from "../types.js";

const LOCAL_STAGES: Stage[] = ["pre-commit", "pre-push"];

function isLocal(stages: Stage[]): boolean {
  return stages.some((s) => LOCAL_STAGES.includes(s));
}

/**
 * The invariant behind the Activity view: a rule can only run and log a hook_run
 * if the dispatcher can actually spawn its implementation. Every rule bound to a
 * local git stage must therefore ship `rules/<slug>/check.mjs`.
 */
describe("dispatch audit — every local-stage rule is runnable", () => {
  const local = RULES.filter((r) => isLocal(r.meta.stages));

  it("covers more than a couple of rules (guards against silent under-wiring)", () => {
    expect(local.length).toBeGreaterThan(20);
  });

  it.each(local.map((r) => r.meta.slug))(
    "%s has a check runner on disk",
    (slug) => {
      expect(existsSync(checkScriptPath(slug))).toBe(true);
    },
  );

  it("keeps server-only rules out of the local dispatcher", () => {
    const serverOnly = RULES.filter(
      (r) => r.meta.stages.includes("server") && !isLocal(r.meta.stages),
    ).map((r) => r.meta.slug);
    expect(serverOnly).toContain("gov-require-pr");
  });

  it("throws resolving a check path for a rule with no local runner", () => {
    // gov-require-pr is server-only (checkEntry: null); the dispatcher must never
    // try to spawn it.
    expect(() => checkScriptPath("gov-require-pr")).toThrow(/no check runner/);
  });
});
