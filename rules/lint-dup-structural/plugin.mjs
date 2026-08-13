/** @type {import("@deterministic-code/captain-obvious/plugin").RulePlugin} */
export default {
  meta: {
    slug: "lint-dup-structural",
    name: "Structural duplication",
    category: "duplication",
    description:
      "Detects repeated structural patterns (e.g. sibling tables), ratcheted against baseline.",
    languages: ["typescript", "javascript"],
    languagesFixed: true,
    config: null,
    ratchetable: true,
    modes: ["push", "staged", "all", "files", "warn"],
    stages: ["pre-push"],
    supportStages: [
      "pre-commit",
      "git-pre-commit",
      "pre-merge-commit",
      "git-pre-merge-commit",
      "pre-push",
      "git-pre-push",
    ],
    defaultAction: "warn",
    order: 14,
    actions: [],
  },
  dependencies: [
    {
      kind: "npm",
      name: "jscpd",
    },
  ],
  checkEntry: "./check.mjs",
};
