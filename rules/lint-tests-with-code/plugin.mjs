/** @type {import("@deterministic-code/captain-obvious/plugin").RulePlugin} */
export default {
  meta: {
    slug: "lint-tests-with-code",
    name: "Tests move with code",
    category: "testing",
    description:
      "Blocks staging a production source change (or new file) with no matching test change in the same commit — the deterministic TDD proxy.",
    languages: ["typescript", "javascript"],
    languagesFixed: true,
    config: null,
    ratchetable: true,
    modes: ["staged", "warn"],
    stages: ["pre-commit"],
    order: 19,
    actions: [],
  },
  dependencies: [],
  checkEntry: "./check.mjs",
};
