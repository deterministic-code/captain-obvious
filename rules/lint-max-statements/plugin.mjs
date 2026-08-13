/** @type {import("@deterministic-code/captain-obvious/plugin").RulePlugin} */
export default {
  meta: {
    slug: "lint-max-statements",
    name: "Max statements per function",
    category: "size",
    description:
      "Flags functions with more than the allowed number of statements.",
    languages: ["typescript", "javascript"],
    languagesFixed: true,
    config: {
      maxStatements: 20,
    },
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
    order: 12,
    actions: [],
  },
  control: {
    kind: "declarative",
    fields: [
      {
        key: "maxStatements",
        label: "Max Statements",
        type: "number",
        min: 1,
      },
    ],
  },
  dependencies: [],
  checkEntry: "./check.mjs",
};
