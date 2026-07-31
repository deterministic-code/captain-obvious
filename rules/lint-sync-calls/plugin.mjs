/** @type {import("@deterministic-code/captain-obvious/plugin").RulePlugin} */
export default {
  meta: {
    slug: "lint-sync-calls",
    name: "Synchronous I/O calls",
    category: "performance",
    description:
      "Blocks blocking sync I/O (readFileSync, etc.) outside DevOps scripts.",
    languages: ["typescript", "javascript"],
    languagesFixed: true,
    config: null,
    ratchetable: false,
    modes: ["staged", "all", "files", "warn"],
    stages: ["pre-commit", "tool"],
    defaultAction: "warn",
    order: 20,
    actions: [],
  },
  dependencies: [],
  checkEntry: "./check.mjs",
};
