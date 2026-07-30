export default {
  meta: {
    name: "No slug",
    category: "governance",
    description: "descriptor missing meta.slug — exercises the config slug fallback",
    languages: [],
    config: null,
    ratchetable: false,
    modes: ["staged"],
    stages: ["pre-commit"],
    actions: [],
  },
  checkEntry: "./check.mjs",
};
