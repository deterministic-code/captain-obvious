/** @type {import("@deterministic-code/captain-obvious/plugin").RulePlugin} */
export default {
  meta: {
    slug: "lint-solid-s",
    name: "SOLID — Single Responsibility",
    category: "solid",
    description:
      "Flags classes with weak cohesion or too many dependencies (LCOM4, deps).",
    languages: ["typescript", "javascript"],
    languagesFixed: true,
    config: {
      lcom4: 1,
      deps: 8,
    },
    ratchetable: false,
    modes: ["staged", "all", "files", "warn"],
    stages: ["pre-commit"],
    defaultAction: "warn",
    order: 26,
    actions: [],
  },
  control: {
    kind: "declarative",
    fields: [
      {
        key: "lcom4",
        label: "Lcom4",
        type: "number",
        min: 1,
      },
      {
        key: "deps",
        label: "Deps",
        type: "number",
        min: 1,
      },
    ],
  },
  dependencies: [],
  checkEntry: "./check.mjs",
};
