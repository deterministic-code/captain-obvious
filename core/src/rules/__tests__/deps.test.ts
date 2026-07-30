import { describe, expect, it } from "vitest";
import { missingRequired, verifyDependencies } from "../deps.js";
import type { RuleDependency, RulePlugin } from "../plugin.js";

function plugin(slug: string, dependencies: RuleDependency[]): RulePlugin {
  return {
    meta: {
      slug,
      name: slug,
      category: "governance",
      description: "d",
      languages: [],
      config: null,
      ratchetable: false,
      modes: ["staged"],
      stages: ["pre-commit"],
    },
    dependencies,
    checkEntry: `rules/${slug}/check.mjs`,
  };
}

describe("verifyDependencies", () => {
  it("probes every declared dependency, skipping rules with none", () => {
    const plugins = [
      plugin("a", [{ kind: "npm", name: "prettier" }]),
      plugin("b", []),
      plugin("c", [{ kind: "bin", name: "gh" }, { kind: "npm", name: "knip" }]),
    ];
    const present = new Set(["prettier", "gh"]);
    const statuses = verifyDependencies(plugins, (d) => present.has(d.name));
    expect(statuses).toEqual([
      { slug: "a", dep: { kind: "npm", name: "prettier" }, present: true },
      { slug: "c", dep: { kind: "bin", name: "gh" }, present: true },
      { slug: "c", dep: { kind: "npm", name: "knip" }, present: false },
    ]);
  });

  it("treats an absent dependencies array as no deps", () => {
    const p = plugin("a", []);
    delete p.dependencies;
    expect(verifyDependencies([p], () => false)).toEqual([]);
  });
});

describe("missingRequired", () => {
  it("keeps only absent, non-optional dependencies", () => {
    const statuses = verifyDependencies(
      [
        plugin("a", [
          { kind: "npm", name: "prettier" },
          { kind: "npm", name: "knip" },
          { kind: "bin", name: "optional-tool", optional: true },
        ]),
      ],
      (d) => d.name === "prettier",
    );
    expect(missingRequired(statuses)).toEqual([
      { slug: "a", dep: { kind: "npm", name: "knip" }, present: false },
    ]);
  });
});
