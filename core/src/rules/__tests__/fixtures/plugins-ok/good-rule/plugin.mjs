/** @type {import("../../../plugin.js").RulePlugin} */
export default {
  meta: {
    slug: "good-rule",
    name: "Good fixture rule",
    category: "governance",
    description: "a valid fixture plugin for the loader tests",
    languages: [],
    config: null,
    ratchetable: false,
    modes: ["staged"],
    stages: ["pre-commit"],
    actions: [],
  },
  control: {
    kind: "declarative",
    fields: [{ key: "limit", label: "Limit", type: "number", min: 1 }],
  },
  dependencies: [],
  checkEntry: "./check.mjs",
};
