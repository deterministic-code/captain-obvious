/** @type {import("../../src/rules/plugin.js").RulePlugin} */
export default {
  "meta": {
    "slug": "lint-empty-catch",
    "name": "Empty catch blocks",
    "category": "error-handling",
    "description": "Blocks empty catch blocks; requires a narrow rethrow, predicate, or logged warning.",
    "languages": [
      "typescript",
      "javascript"
    ],
    "config": null,
    "ratchetable": false,
    "modes": [
      "staged",
      "all",
      "files",
      "warn"
    ],
    "stages": [
      "pre-commit"
    ],
    "actions": []
  },
  "dependencies": [],
  "checkEntry": "./check.mjs"
};
