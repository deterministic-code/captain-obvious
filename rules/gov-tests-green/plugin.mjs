/** @type {import("@deterministic-code/captain-obvious/plugin").RulePlugin} */
export default {
  meta: {
    slug: "gov-tests-green",
    name: "Block on failing local tests",
    category: "governance",
    description:
      "Runs the project's test suite and blocks commit/push when it fails. Bypass: ALLOW_COMMIT_ON_RED_TESTS=1.",
    languages: [],
    config: {
      testCommand: "npm test",
      timeoutMs: 600000,
    },
    ratchetable: false,
    modes: ["staged", "push", "warn"],
    stages: ["pre-commit", "pre-push"],
    defaultAction: "halt",
    order: 31,
    actions: [],
  },
  control: {
    kind: "declarative",
    fields: [
      {
        key: "testCommand",
        label: "Test Command",
        type: "string",
        placeholder: "npm test",
        help: "Shell command to run the test suite. Runs via a shell, so shell operators (&&, --) are supported.",
      },
      {
        key: "timeoutMs",
        label: "Timeout (ms)",
        type: "number",
        min: 1000,
        step: 1000,
        help: "Kill the test command if it runs longer than this (default 600000 = 10 minutes).",
      },
    ],
  },
  dependencies: [],
  checkEntry: "./check.mjs",
};
