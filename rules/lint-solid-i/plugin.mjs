/** @type {import("@deterministic-code/captain-obvious/plugin").RulePlugin} */
export default {
  "meta": {
    "slug": "lint-solid-i",
    "name": "SOLID — Interface Segregation",
    "category": "solid",
    "description": "Flags violations of the Interface Segregation principle.",
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
