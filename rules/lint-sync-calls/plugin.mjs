/** @type {import("@deterministic-code/captain-obvious/plugin").RulePlugin} */
export default {
  meta: {
    slug: "lint-sync-calls",
    name: "Synchronous I/O calls",
    category: "performance",
    description:
      "Blocks blocking sync I/O (readFileSync, etc.) outside DevOps scripts.",
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
