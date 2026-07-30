/** @type {import("../../src/rules/plugin.js").RulePlugin} */
export default {
  "meta": {
    "slug": "lint-max-lines",
    "name": "Max lines per function",
    "category": "size",
    "description": "Flags functions longer than the line limit.",
    "languages": [
      "typescript",
      "javascript"
    ],
    "config": {
      "maxLines": 60
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
        "key": "maxLines",
        "label": "Max Lines",
        "type": "number",
        "min": 1
      }
    ]
  },
  "dependencies": [],
  "checkEntry": "./check.mjs"
};
