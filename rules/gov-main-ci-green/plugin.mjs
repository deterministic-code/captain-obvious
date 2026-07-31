/** @type {import("@deterministic-code/captain-obvious/plugin").RulePlugin} */
export default {
  meta: {
    slug: "gov-main-ci-green",
    name: "Block on red main CI",
    category: "governance",
    description:
      "Blocks commits/merges while the latest Tests run on main failed in a blocking job (gh). Bypass: ALLOW_COMMIT_ON_RED_MAIN=1.",
    languages: [],
    config: {
      branch: "main",
      blockingJobs: ["unit", "integration"],
    },
    ratchetable: false,
    modes: ["push", "warn"],
    stages: ["pre-push"],
    actions: [],
  },
  control: {
    kind: "declarative",
    fields: [
      {
        key: "branch",
        label: "Branch",
        type: "string",
      },
      {
        key: "blockingJobs",
        label: "Blocking Jobs",
        type: "list",
      },
    ],
  },
  dependencies: [
    {
      kind: "bin",
      name: "gh",
      reason: "reads the latest main CI status",
    },
  ],
  checkEntry: "./check.mjs",
};
