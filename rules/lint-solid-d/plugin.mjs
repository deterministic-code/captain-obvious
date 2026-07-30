/** @type {import("../../src/rules/plugin.js").RulePlugin} */
export default {
  "meta": {
    "slug": "lint-solid-d",
    "name": "SOLID — Dependency Inversion",
    "category": "solid",
    "description": "Flags violations of the Dependency Inversion principle.",
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
