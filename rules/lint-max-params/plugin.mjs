/** @type {import("@deterministic-code/captain-obvious/plugin").RulePlugin} */
export default {
  meta: {
    slug: "lint-max-params",
    name: "Max parameters per function",
    category: "size",
    description:
      "Flags functions with more than the allowed number of parameters.",
    languages: ["typescript", "javascript"],
    languagesFixed: true,
    config: {
      maxParams: 3,
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
        key: "maxParams",
        label: "Max Params",
        type: "number",
        min: 1,
      },
    ],
  },
  dependencies: [],
  checkEntry: "./check.mjs",
};
