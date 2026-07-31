/** @type {import("@deterministic-code/captain-obvious/plugin").RulePlugin} */
export default {
  meta: {
    slug: "lint-solid-d",
    name: "SOLID — Dependency Inversion",
    category: "solid",
    description: "Flags violations of the Dependency Inversion principle.",
    languages: ["typescript", "javascript"],
    languagesFixed: true,
    config: null,
    ratchetable: false,
    modes: ["staged", "all", "files", "warn"],
    stages: ["pre-commit"],
    defaultAction: "warn",
    order: 22,
    actions: [],
  },
  dependencies: [],
  checkEntry: "./check.mjs",
};
