import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDb, type Db } from "../../db/open.js";
import { addRule, configureRule } from "../../db/rules.js";
import { createProject } from "../registry.js";
import type { RuleView } from "../registry.js";
import {
  buildInferenceRules,
  buildStyleGuide,
  inferenceRules,
  styleGuide,
} from "../tools.js";

function mk(
  over: Partial<RuleView> & { slug: string; name: string },
): RuleView {
  return {
    description: null,
    category: null,
    categories: [],
    languages: [],
    languageIndependent: false,
    languagesFixed: false,
    stage: null,
    stages: [],
    order: 0,
    enabled: true,
    config: null,
    defaultAction: null,
    envActions: [],
    actions: [],
    control: null,
    deps: [],
    settingsControls: [],
    ...over,
  };
}

describe("buildStyleGuide", () => {
  it("reports when nothing is enabled", () => {
    expect(buildStyleGuide([])).toBe(
      "# Style Guide\n\n_No rules are enabled._\n",
    );
  });

  it("uses the singular for a single rule", () => {
    const text = buildStyleGuide([
      mk({ slug: "a", name: "Alpha", description: "Does a thing." }),
    ]);
    expect(text).toContain("The following 1 rule is enforced:");
    expect(text).toContain("- **Alpha** — Does a thing.");
  });

  it("uses the plural and interpolates config thresholds", () => {
    const text = buildStyleGuide([
      mk({
        slug: "a",
        name: "Alpha",
        description: "Bounds complexity",
        config: { maxComplexity: 15, langs: ["ts", "js"], opts: { a: 1 } },
      }),
      mk({ slug: "b", name: "Beta", description: null }),
    ]);
    expect(text).toContain("The following 2 rules are enforced:");
    expect(text).toContain(
      '- **Alpha** — Bounds complexity (maxComplexity: 15; langs: ts, js; opts: {"a":1})',
    );
    expect(text).toContain("- **Beta** — Beta");
  });
});

describe("buildInferenceRules", () => {
  it("reports when nothing is enabled", () => {
    expect(buildInferenceRules([])).toBe(
      "# Inference Rules\n\n_No rules are enabled._\n",
    );
  });

  it("composes multi-sentence prose covering every field and posture", () => {
    const text = buildInferenceRules([
      mk({
        slug: "a",
        name: "Alpha",
        description: "Bounds complexity",
        config: { maxComplexity: 15 },
        actions: [{ kind: "inferred", description: "Refactor the function" }],
        stages: ["pre-commit"],
        defaultAction: { type: "warn" },
      }),
      mk({
        slug: "b",
        name: "Beta",
        description: "Already terminated.",
        stages: ["tool"],
      }),
      mk({ slug: "c", name: "Gamma", defaultAction: { type: "halt" } }),
      mk({ slug: "d", name: "Delta", actions: [{ kind: "output" }] }),
    ]);
    expect(text).toContain(
      "## Alpha\nBounds complexity. Configured thresholds: maxComplexity: 15. Refactor the function. This rule runs at pre-commit and defaults to warn.",
    );
    expect(text).toContain(
      "## Beta\nAlready terminated. This rule runs at tool.",
    );
    expect(text).toContain("## Gamma\nThis rule defaults to halt.");
    expect(text).toContain("## Delta\nDelta.");
    expect(text.endsWith("\n")).toBe(true);
    expect(text.endsWith("\n\n")).toBe(false);
  });
});

describe("registry-backed handlers", () => {
  let db: Db;
  beforeEach(() => {
    db = openDb(":memory:");
    addRule(db, { slug: "lint-on", name: "On", description: "Kept." });
    addRule(db, { slug: "lint-off", name: "Off", description: "Dropped." });
    configureRule(db, "lint-off", { enabled: false });
  });
  afterEach(() => db.close());

  it("styleGuide (global) includes only enabled rules", () => {
    const { text } = styleGuide(db, null);
    expect(text).toContain("- **On** — Kept.");
    expect(text).not.toContain("Off");
  });

  it("inferenceRules is project-scoped when given a project id", () => {
    const project = createProject(db, { name: "Proj" });
    const { text } = inferenceRules(db, project.id);
    expect(text).toContain("## On");
    expect(text).not.toContain("## Off");
  });
});
