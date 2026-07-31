/** @type {import("@deterministic-code/captain-obvious/plugin").RulePlugin} */
export default {
  meta: {
    slug: "lint-max-lines",
    name: "Max lines per function",
    category: "size",
    description: "Flags functions longer than the line limit.",
    languages: ["typescript", "javascript"],
    languagesFixed: true,
    config: {
      maxLines: 60,
    },
    ratchetable: false,
    modes: ["staged", "all", "files", "warn"],
    stages: ["pre-commit", "tool"],
    defaultAction: "warn",
    order: 10,
    actions: [],
  },
  control: {
    kind: "declarative",
    fields: [
      {
        key: "maxLines",
        label: "Max Lines",
        type: "number",
        min: 1,
      },
    ],
  },
  dependencies: [],
  checkEntry: "./check.mjs",
};
