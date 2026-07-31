/** @type {import("@deterministic-code/captain-obvious/plugin").RulePlugin} */
export default {
  meta: {
    slug: "lint-emitter-casing",
    name: "Emitter event casing",
    category: "naming",
    description:
      "Enforces case conventions for EventEmitter event names in template literals.",
    languages: ["typescript", "javascript"],
    languagesFixed: true,
    config: null,
    ratchetable: false,
    modes: ["staged", "all", "files", "warn"],
    stages: ["pre-commit"],
    order: 7,
    actions: [],
  },
  dependencies: [],
  checkEntry: "./check.mjs",
};
