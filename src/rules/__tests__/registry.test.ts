import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { RULES } from "../index.js";
import type { RuleCategory } from "../types.js";

const pkgRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

const CATEGORIES: RuleCategory[] = [
  "duplication",
  "solid",
  "size",
  "complexity",
  "naming",
  "comments",
  "error-handling",
  "performance",
  "api-stability",
  "dead-code",
  "testing",
  "formatting",
  "governance",
];

const ACTION_KINDS = ["inferred", "script", "output"];

describe("RULES registry", () => {
  it("has 31 rules with unique slugs", () => {
    expect(RULES).toHaveLength(31);
    const slugs = RULES.map((r) => r.meta.slug);
    expect(new Set(slugs).size).toBe(31);
  });

  it("uses only known categories (primary and extras)", () => {
    for (const r of RULES) {
      expect(CATEGORIES).toContain(r.meta.category);
      for (const c of r.meta.categories ?? []) {
        expect(CATEGORIES, r.meta.slug).toContain(c);
      }
    }
  });

  it("declares only valid actions (script actions carry a scriptPath)", () => {
    for (const r of RULES) {
      for (const a of r.meta.actions ?? []) {
        expect(ACTION_KINDS, r.meta.slug).toContain(a.kind);
        if (a.kind === "script") {
          expect(a.scriptPath, r.meta.slug).toBeTruthy();
        }
      }
    }
  });

  // Language-independent rules (empty `languages`) police the repo/workflow or an
  // artifact, not source files. Governance rules are always agnostic; other rules
  // must opt in here so a forgotten `languages` list still fails the >0 check.
  const LANGUAGE_INDEPENDENT = new Set(["lint-frozen-interfaces"]);

  it("targets only supported languages; language-independent rules declare none", () => {
    for (const r of RULES) {
      const agnostic =
        r.meta.category === "governance" || LANGUAGE_INDEPENDENT.has(r.meta.slug);
      if (agnostic) {
        expect(r.meta.languages, r.meta.slug).toEqual([]);
        continue;
      }
      expect(r.meta.languages.length, r.meta.slug).toBeGreaterThan(0);
      for (const l of r.meta.languages) {
        expect(["typescript", "javascript"]).toContain(l);
      }
    }
  });

  it("has JSON-serializable config", () => {
    for (const r of RULES) {
      expect(() => JSON.stringify(r.meta.config)).not.toThrow();
    }
  });

  it("exposes a run function on every rule", () => {
    for (const r of RULES) {
      expect(typeof r.run).toBe("function");
    }
  });

  it("every runnable rule's hook exports a callable main (so run delegates)", async () => {
    for (const r of RULES) {
      // Server-stage governance rules (e.g. gov-require-pr) are enforced by
      // GitHub branch protection and carry no local runner.
      if (r.meta.stages.includes("server")) continue;
      const hookPath = resolve(pkgRoot, "hooks", "git", `${r.meta.slug}.mjs`);
      const mod = await import(pathToFileURL(hookPath).href);
      expect(typeof mod.main, r.meta.slug).toBe("function");
    }
  });

  it("server-stage rules have no local runner and target no language", () => {
    const serverRules = RULES.filter((r) => r.meta.stages.includes("server"));
    expect(serverRules.map((r) => r.meta.slug)).toEqual(["gov-require-pr"]);
    for (const r of serverRules) {
      expect(r.meta.category).toBe("governance");
      expect(r.meta.languages).toEqual([]);
    }
  });
});
