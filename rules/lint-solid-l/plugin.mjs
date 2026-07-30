/** @type {import("../../src/rules/plugin.js").RulePlugin} */
export default {
  "meta": {
    "slug": "lint-solid-l",
    "name": "SOLID — Liskov Substitution",
    "category": "solid",
    "description": "Flags violations of the Liskov Substitution principle.",
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
