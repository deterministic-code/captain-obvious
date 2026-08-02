export default {
  meta: {
    name: "No slug",
    category: "governance",
    description:
      "descriptor missing meta.slug — the folder scan rejects the slug mismatch",
    languages: [],
    config: null,
    ratchetable: false,
    modes: ["staged"],
    stages: ["pre-commit"],
    actions: [],
  },
  checkEntry: "./check.mjs",
};
