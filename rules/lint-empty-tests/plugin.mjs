/** @type {import("@deterministic-code/captain-obvious/plugin").RulePlugin} */
export default {
  meta: {
    slug: "lint-empty-tests",
    name: "Empty tests",
    category: "testing",
    description:
      "Flags it()/test() with no callback or no assertion (expect/assert) — tests that pass vacuously.",
    languages: ["typescript", "javascript"],
    languagesFixed: true,
    config: null,
    ratchetable: false,
    modes: ["staged", "all", "files", "warn"],
    stages: ["pre-commit"],
    order: 15,
    actions: [],
  },
  dependencies: [],
  checkEntry: "./check.mjs",
};
