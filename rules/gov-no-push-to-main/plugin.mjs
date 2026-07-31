/** @type {import("@deterministic-code/captain-obvious/plugin").RulePlugin} */
export default {
  meta: {
    slug: "gov-no-push-to-main",
    name: "No direct commits on main",
    category: "governance",
    description:
      "Blocks committing directly on main/master; work must happen on a branch. Bypass: ALLOW_EDIT_ON_MAIN=1.",
    languages: [],
    config: {
      branches: ["main", "master"],
    },
    ratchetable: false,
    modes: ["push", "warn"],
    stages: ["pre-push"],
    defaultAction: "warn",
    order: 27,
    actions: [],
  },
  control: {
    kind: "declarative",
    fields: [
      {
        key: "branches",
        label: "Branches",
        type: "list",
      },
    ],
  },
  dependencies: [],
  checkEntry: "./check.mjs",
};
