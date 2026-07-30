/** @type {import("../../src/rules/plugin.js").RulePlugin} */
export default {
  "meta": {
    "slug": "lint-dup-structural",
    "name": "Structural duplication",
    "category": "duplication",
    "description": "Detects repeated structural patterns (e.g. sibling tables), ratcheted against baseline.",
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
