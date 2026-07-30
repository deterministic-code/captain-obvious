/** @type {import("@deterministic-code/captain-obvious/plugin").RulePlugin} */
export default {
  "meta": {
    "slug": "lint-coverage",
    "name": "Coverage ratchet",
    "category": "testing",
    "description": "Blocks a drop in test coverage below the committed baseline (coverage-baseline.json); reads coverage/coverage-summary.json. Accept a new floor with --update.",
    "languages": [
      "typescript",
      "javascript"
    ],
    "config": null,
    "ratchetable": true,
    "modes": [
      "push",
      "staged",
      "all",
      "files",
      "warn"
    ],
    "stages": [
      "pre-push"
    ],
    "actions": []
  },
  "dependencies": [],
  "checkEntry": "./check.mjs"
};
