/** @type {import("@deterministic-code/captain-obvious/plugin").RulePlugin} */
export default {
  "meta": {
    "slug": "lint-max-statements",
    "name": "Max statements per function",
    "category": "size",
    "description": "Flags functions with more than the allowed number of statements.",
    "languages": [
      "typescript",
      "javascript"
    ],
    "config": {
      "maxStatements": 20
    },
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
  "control": {
    "kind": "declarative",
    "fields": [
      {
        "key": "maxStatements",
        "label": "Max Statements",
        "type": "number",
        "min": 1
      }
    ]
  },
  "dependencies": [],
  "checkEntry": "./check.mjs"
};
