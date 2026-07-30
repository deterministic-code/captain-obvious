export default {
  meta: {
    slug: "missing-check",
    name: "Missing check",
    category: "governance",
    description: "checkEntry points at a file that does not exist",
    languages: [],
    config: null,
    ratchetable: false,
    modes: ["staged"],
    stages: ["pre-commit"],
    actions: [],
  },
  checkEntry: "./nope.mjs",
};
