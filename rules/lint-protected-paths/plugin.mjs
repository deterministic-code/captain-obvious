/** @type {import("../../src/rules/plugin.js").RulePlugin} */
export default {
  "meta": {
    "slug": "lint-protected-paths",
    "name": "Protected paths",
    "category": "governance",
    "description": "Blocks staging (git) or editing (Claude Code) any path matching the project's protected globs (project settings).",
    "languages": [],
    "config": null,
    "ratchetable": false,
    "modes": [
      "staged",
      "all",
      "files"
    ],
    "stages": [
      "pre-commit",
      "claude-tool"
    ],
    "actions": []
  },
  "control": {
    "kind": "custom",
    "key": "protected-paths"
  },
  "dependencies": [],
  "checkEntry": "./check.mjs"
};
