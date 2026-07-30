export default {
  meta: {
    slug: "dup-rule",
    name: "Dup rule",
    category: "governance",
    description: "listed in config AND present as a folder dir (dedupe test)",
    languages: [],
    config: null,
    ratchetable: false,
    modes: ["staged"],
    stages: ["pre-commit"],
    actions: [],
  },
  checkEntry: "./check.mjs",
};
