/** @type {import("@deterministic-code/captain-obvious/plugin").RulePlugin} */
export default {
  meta: {
    slug: "lint-coverage",
    name: "Coverage ratchet",
    category: "testing",
    description:
      "Blocks a drop in test coverage below the committed baseline (coverage-baseline.json); reads coverage/coverage-summary.json. Accept a new floor with --update.",
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
    order: 28,
    actions: [],
  },
  dependencies: [],
  checkEntry: "./check.mjs",
};
