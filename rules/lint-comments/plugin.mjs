/** @type {import("@deterministic-code/captain-obvious/plugin").RulePlugin} */
export default {
  "meta": {
    "slug": "lint-comments",
    "name": "Comment hygiene",
    "category": "comments",
    "description": "Flags empty, malformed, or excessive consecutive comments; discourages block comments.",
    "languages": [
      "typescript",
      "javascript"
    ],
    "config": null,
    "ratchetable": false,
    "modes": [
      "staged",
      "files"
    ],
    "stages": [
      "pre-commit"
    ],
    "actions": []
  },
  "dependencies": [],
  "checkEntry": "./check.mjs"
};
