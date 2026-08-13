/** @type {import("@deterministic-code/captain-obvious/plugin").RulePlugin} */
export default {
  meta: {
    slug: "lint-protected-paths",
    name: "Protected paths",
    category: "governance",
    description:
      "Blocks staging (git) or editing (Claude Code) any path matching the project's protected globs (project settings).",
    languages: [],
    config: null,
    ratchetable: false,
    modes: ["staged", "all", "files"],
    stages: ["pre-commit", "tool"],
    supportStages: [
      "pre-commit",
      "git-pre-commit",
      "pre-merge-commit",
      "git-pre-merge-commit",
      "pre-push",
      "git-pre-push",
      "tool",
    ],
    defaultAction: "warn",
    order: 0,
    actions: [],
  },
  control: {
    kind: "custom",
    key: "protected-paths",
  },
  dependencies: [],
  checkEntry: "./check.mjs",
};
