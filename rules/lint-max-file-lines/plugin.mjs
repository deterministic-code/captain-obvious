/** @type {import("@deterministic-code/captain-obvious/plugin").RulePlugin} */
export default {
  meta: {
    slug: "lint-max-file-lines",
    name: "Max lines per file",
    category: "size",
    description: "Flags source files longer than the line limit.",
    languages: ["typescript", "javascript"],
    languagesFixed: true,
    config: {
      maxFileLines: 300,
    },
    ratchetable: false,
    modes: ["staged", "all", "files", "warn"],
    stages: ["pre-commit"],
    actions: [],
  },
  control: {
    kind: "declarative",
    fields: [
      {
        key: "maxFileLines",
        label: "Max File Lines",
        type: "number",
        min: 1,
      },
    ],
  },
  dependencies: [],
  checkEntry: "./check.mjs",
};
