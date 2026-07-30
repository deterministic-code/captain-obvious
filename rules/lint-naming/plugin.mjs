/** @type {import("../../src/rules/plugin.js").RulePlugin} */
export default {
  "meta": {
    "slug": "lint-naming",
    "name": "Naming conventions",
    "category": "naming",
    "description": "PascalCase for types/classes; camelCase/PascalCase/UPPER_SNAKE for values (blocks snake_case).",
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
