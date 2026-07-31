/** @type {import("@deterministic-code/captain-obvious/plugin").RulePlugin} */
export default {
  meta: {
    slug: "lint-dup-fn",
    name: "Duplicate functions",
    category: "duplication",
    description:
      "Detects duplicated function bodies (AST clones) in production code.",
    languages: ["typescript", "javascript"],
    languagesFixed: true,
    config: null,
    ratchetable: true,
    modes: ["push", "staged", "all", "files", "warn"],
    stages: ["pre-push", "tool"],
    defaultAction: "warn",
    order: 6,
    actions: [],
  },
  dependencies: [
    {
      kind: "npm",
      name: "jscpd",
    },
  ],
  checkEntry: "./check.mjs",
};
