/** @type {import("@deterministic-code/captain-obvious/plugin").RulePlugin} */
export default {
  meta: {
    slug: "lint-naming",
    name: "Naming conventions",
    category: "naming",
    description:
      "PascalCase for types/classes; camelCase/PascalCase/UPPER_SNAKE for values (blocks snake_case).",
    languages: ["typescript", "javascript"],
    languagesFixed: true,
    config: null,
    ratchetable: false,
    modes: ["staged", "all", "files", "warn"],
    stages: ["pre-commit"],
    actions: [
      {
        kind: "inferred",
        description:
          "Rename offending identifiers to the convention (camelCase for values, PascalCase for types), updating their references.",
      },
    ],
  },
  dependencies: [],
  checkEntry: "./check.mjs",
};
