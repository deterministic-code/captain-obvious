/** @type {import("@deterministic-code/captain-obvious/plugin").RulePlugin} */
export default {
  meta: {
    slug: "lint-max-line-length",
    name: "Max line length",
    category: "size",
    description: "Flags lines wider than the column limit.",
    languages: ["typescript", "javascript"],
    languagesFixed: true,
    config: {
      maxLineLength: 100,
    },
    ratchetable: false,
    modes: ["staged", "all", "files", "warn"],
    stages: ["pre-commit"],
    order: 9,
    actions: [],
  },
  control: {
    kind: "declarative",
    fields: [
      {
        key: "maxLineLength",
        label: "Max Line Length",
        type: "number",
        min: 1,
      },
    ],
  },
  dependencies: [],
  checkEntry: "./check.mjs",
};
