/** @type {import("@deterministic-code/captain-obvious/plugin").RulePlugin} */
export default {
  meta: {
    slug: "lint-frozen-interfaces",
    name: "Frozen interfaces",
    category: "api-stability",
    description:
      "Prevents changes to signatures marked frozen (baseline in interface-frozen.yaml).",
    languages: [],
    config: null,
    ratchetable: true,
    modes: ["push", "staged", "all", "files", "warn"],
    stages: ["pre-commit", "tool"],
    supportStages: [
      "pre-commit",
      "git-pre-commit",
      "pre-merge-commit",
      "git-pre-merge-commit",
      "pre-push",
      "git-pre-push",
      "tool",
    ],
    defaultAction: "warn",
    order: 1,
    actions: [],
  },
  dependencies: [],
  checkEntry: "./check.mjs",
};
