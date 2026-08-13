/** @type {import("@deterministic-code/captain-obvious/plugin").RulePlugin} */
export default {
  meta: {
    slug: "gov-merge-before-stop",
    name: "Merge before stopping",
    category: "governance",
    description:
      "Blocks ending a Claude Code session while work is unmerged: uncommitted changes, unpushed commits, an open non-draft PR, or commits not on main.",
    languages: [],
    config: {
      branches: ["main", "master"],
    },
    ratchetable: false,
    modes: ["warn"],
    stages: ["stop"],
    supportStages: ["stop"],
    defaultAction: "warn",
    order: 30,
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
