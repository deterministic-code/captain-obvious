/** @type {import("@deterministic-code/captain-obvious/plugin").RulePlugin} */
export default {
  meta: {
    slug: "lint-comments",
    name: "Comment hygiene",
    category: "comments",
    description:
      "Flags empty, malformed, or excessive consecutive comments; discourages block comments.",
    languages: ["typescript", "javascript"],
    languagesFixed: true,
    config: null,
    ratchetable: false,
    modes: ["staged", "files"],
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
    order: 4,
    actions: [],
  },
  dependencies: [],
  checkEntry: "./check.mjs",
};
