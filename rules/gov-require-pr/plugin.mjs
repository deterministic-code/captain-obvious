/** @type {import("@deterministic-code/captain-obvious/plugin").RulePlugin} */
export default {
  meta: {
    slug: "gov-require-pr",
    name: "Require pull request",
    category: "governance",
    description:
      "Policy: changes to main must land via pull request. Enforced server-side by GitHub branch protection (.github/rulesets/main.json); no local runner.",
    languages: [],
    config: {
      branch: "main",
      ruleset: ".github/rulesets/main.json",
    },
    ratchetable: false,
    modes: [],
    stages: ["tool", "server"],
    defaultAction: "warn",
    order: 29,
    actions: [],
  },
  control: {
    kind: "custom",
    key: "project-note",
  },
  dependencies: [],
  checkEntry: null,
};
