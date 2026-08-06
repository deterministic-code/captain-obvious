export default {
  meta: {
    slug: "beta",
    name: "beta rule",
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
