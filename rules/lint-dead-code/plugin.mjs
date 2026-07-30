/** @type {import("@deterministic-code/captain-obvious/plugin").RulePlugin} */
export default {
  "meta": {
    "slug": "lint-dead-code",
    "name": "Dead code",
    "category": "dead-code",
    "description": "Detects unused files, exports, and enum members (knip).",
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
      "pre-push"
    ],
    "actions": []
  },
  "dependencies": [
    {
      "kind": "npm",
      "name": "knip"
    }
  ],
  "checkEntry": "./check.mjs"
};
