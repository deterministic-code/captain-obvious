/** @type {import("@deterministic-code/captain-obvious/plugin").RulePlugin} */
export default {
  meta: {
    slug: "lint-test-determinism",
    name: "Test determinism",
    category: "testing",
    description:
      "Flags nondeterministic sources in tests — Date.now/new Date()/performance.now, Math.random, and real network (fetch/XMLHttpRequest).",
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
