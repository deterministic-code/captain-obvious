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
];

describe("RULES registry", () => {
  it("has 20 rules with unique slugs", () => {
    expect(RULES).toHaveLength(20);
    const slugs = RULES.map((r) => r.meta.slug);
    expect(new Set(slugs).size).toBe(20);
  });

  it("uses only known categories", () => {
    for (const r of RULES) {
      expect(CATEGORIES).toContain(r.meta.category);
    }
  });

  it("targets only supported languages", () => {
    for (const r of RULES) {
      expect(r.meta.languages.length).toBeGreaterThan(0);
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

  it("every rule's hook exports a callable main (so run delegates)", async () => {
    for (const r of RULES) {
      const hookPath = resolve(pkgRoot, "hooks", "git", `${r.meta.slug}.mjs`);
      const mod = await import(pathToFileURL(hookPath).href);
      expect(typeof mod.main, r.meta.slug).toBe("function");
    }
  });
});
