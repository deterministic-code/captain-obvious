/** @type {import("../../src/rules/plugin.js").RulePlugin} */
export default {
  "meta": {
    "slug": "lint-dup",
    "name": "Token duplication",
    "category": "duplication",
    "description": "Detects token-based copy-paste clones across the repo (jscpd).",
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
  "dependencies": [
    {
      "kind": "npm",
      "name": "jscpd"
    }
  ],
  "checkEntry": "./check.mjs"
};
