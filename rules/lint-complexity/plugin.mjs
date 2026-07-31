/** @type {import("@deterministic-code/captain-obvious/plugin").RulePlugin} */
export default {
  meta: {
    slug: "lint-complexity",
    name: "Cyclomatic complexity",
    category: "complexity",
    description:
      "Flags functions whose cyclomatic complexity exceeds the limit.",
    languages: ["typescript", "javascript"],
    languagesFixed: true,
    config: {
      maxComplexity: 15,
    },
    ratchetable: false,
    modes: ["staged", "all", "files", "warn"],
    stages: ["pre-commit"],
    defaultAction: "warn",
    order: 21,
    actions: [],
  },
  control: {
    kind: "declarative",
    fields: [
      {
        key: "maxComplexity",
        label: "Max Complexity",
        type: "number",
        min: 1,
      },
    ],
  },
  dependencies: [],
  checkEntry: "./check.mjs",
};
