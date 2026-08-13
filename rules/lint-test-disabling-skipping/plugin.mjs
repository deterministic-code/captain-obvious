/** @type {import("@deterministic-code/captain-obvious/plugin").RulePlugin} */
export default {
  meta: {
    slug: "lint-test-disabling-skipping",
    name: "Test disabling / skipping",
    category: "testing",
    description:
      "Blocks .skip/.only/.fixme/.skipIf/.todo, xit/xdescribe, fdescribe/fit, and this.skip() across test tiers.",
    languages: ["typescript", "javascript"],
    languagesFixed: true,
    config: null,
    ratchetable: true,
    modes: ["push", "staged", "all", "files", "warn"],
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
    order: 18,
    actions: [],
  },
  dependencies: [],
  checkEntry: "./check.mjs",
};
