/** @type {import("@deterministic-code/captain-obvious/plugin").RulePlugin} */
export default {
  meta: {
    slug: "lint-prettier",
    name: "Prettier formatting",
    category: "formatting",
    description:
      "Flags files that are not Prettier-formatted (prettier --check); the fix action runs prettier --write.",
    languages: ["typescript", "javascript"],
    languagesFixed: true,
    config: null,
    ratchetable: false,
    modes: ["staged", "all", "files", "warn"],
    stages: ["pre-commit"],
    order: 2,
    actions: [
      {
        kind: "script",
        scriptPath: "rules/lint-prettier/check.mjs",
        description:
          "Reformat with prettier --write (invoke the hook with --fix).",
      },
    ],
  },
  dependencies: [
    {
      kind: "npm",
      name: "prettier",
    },
  ],
  checkEntry: "./check.mjs",
};
