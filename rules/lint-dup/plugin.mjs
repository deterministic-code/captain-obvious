/** @type {import("@deterministic-code/captain-obvious/plugin").RulePlugin} */
export default {
  meta: {
    slug: "lint-dup",
    name: "Token duplication",
    category: "duplication",
    description:
      "Detects token-based copy-paste clones across the repo (jscpd).",
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
    order: 5,
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
