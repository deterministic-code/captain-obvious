/** @type {import("@deterministic-code/captain-obvious/plugin").RulePlugin} */
export default {
  meta: {
    slug: "lint-empty-catch",
    name: "Empty catch blocks",
    category: "error-handling",
    description:
      "Blocks empty catch blocks; requires a narrow rethrow, predicate, or logged warning.",
    languages: ["typescript", "javascript"],
    languagesFixed: true,
    config: null,
    ratchetable: false,
    modes: ["staged", "all", "files", "warn"],
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
    order: 16,
    actions: [],
  },
  dependencies: [],
  checkEntry: "./check.mjs",
};
