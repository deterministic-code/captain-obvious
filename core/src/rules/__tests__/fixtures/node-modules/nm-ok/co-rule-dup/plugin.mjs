export default {
  meta: {
    slug: "good-rule",
    name: "good-rule rule",
    category: "governance",
    description: "installed fixture rule",
    languages: [],
    config: null,
    ratchetable: false,
    modes: ["staged"],
    stages: ["pre-commit"],
  },
  checkEntry: "./check.mjs",
};
