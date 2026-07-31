/** @type {import("@deterministic-code/captain-obvious/plugin").RulePlugin} */
export default {
  meta: {
    slug: "lint-solid-o",
    name: "SOLID — Open/Closed",
    category: "solid",
    description: "Flags violations of the Open/Closed principle.",
    languages: ["typescript", "javascript"],
    config: null,
    ratchetable: false,
    modes: ["staged", "all", "files", "warn"],
    stages: ["pre-commit"],
    actions: [],
  },
  dependencies: [],
  checkEntry: "./check.mjs",
};
