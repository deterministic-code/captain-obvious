/** @type {import("@deterministic-code/captain-obvious/plugin").RulePlugin} */
export default {
  meta: {
    slug: "lint-frozen-interfaces",
    name: "Frozen interfaces",
    category: "api-stability",
    description:
      "Prevents changes to signatures marked frozen (baseline in interface-frozen.yaml).",
    languages: [],
    config: null,
    ratchetable: true,
    modes: ["push", "staged", "all", "files", "warn"],
    stages: ["pre-commit"],
    order: 1,
    actions: [],
  },
  dependencies: [],
  checkEntry: "./check.mjs",
};
