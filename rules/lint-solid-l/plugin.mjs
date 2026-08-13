/** @type {import("@deterministic-code/captain-obvious/plugin").RulePlugin} */
export default {
  meta: {
    slug: "lint-solid-l",
    name: "SOLID — Liskov Substitution",
    category: "solid",
    description: "Flags violations of the Liskov Substitution principle.",
    languages: ["typescript", "javascript"],
    languagesFixed: true,
    config: null,
    ratchetable: false,
    modes: ["staged", "all", "files", "warn"],
    stages: ["pre-commit"],
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
    order: 24,
    actions: [],
  },
  dependencies: [],
  checkEntry: "./check.mjs",
};
