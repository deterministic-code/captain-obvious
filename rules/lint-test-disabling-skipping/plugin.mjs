/** @type {import("@deterministic-code/captain-obvious/plugin").RulePlugin} */
export default {
  "meta": {
    "slug": "lint-test-disabling-skipping",
    "name": "Test disabling / skipping",
    "category": "testing",
    "description": "Blocks .skip/.only/.fixme/.skipIf/.todo, xit/xdescribe, fdescribe/fit, and this.skip() across test tiers.",
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
      "pre-commit"
    ],
    "actions": []
  },
  "dependencies": [],
  "checkEntry": "./check.mjs"
};
