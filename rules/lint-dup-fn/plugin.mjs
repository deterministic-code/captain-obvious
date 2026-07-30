/** @type {import("@deterministic-code/captain-obvious/plugin").RulePlugin} */
export default {
  "meta": {
    "slug": "lint-dup-fn",
    "name": "Duplicate functions",
    "category": "duplication",
    "description": "Detects duplicated function bodies (AST clones) in production code.",
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
