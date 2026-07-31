#!/usr/bin/env node
import {
  isInvokedAsScript,
  runFileHook,
} from "@deterministic-code/co-rule-kit/lint-shared";
import { loadProtected } from "@deterministic-code/co-rule-kit/protected-globs";

function usage() {
  process.stderr.write(
    "Usage:\n  node rules/lint-protected-paths/check.mjs --staged\n  node rules/lint-protected-paths/check.mjs --all\n  node rules/lint-protected-paths/check.mjs --files <path> [...]\n",
  );
  process.exit(2);
}

/** `load` is injectable so tests exercise the check without the compiled dist. */
export async function main(argv, load = loadProtected) {
  const { globs, match } = await load();
  return runFileHook(argv, {
    usage,
    collect: (path) =>
      match(path, globs)
        ? [
            {
              line: 1,
              col: 1,
              kind: "protected path",
              detail: `${path} is a protected path (captain-obvious project settings); remove it from this changeset or unprotect it in the control panel.`,
              path,
            },
          ]
        : [],
    okLine: "lint-protected-paths: no protected paths in changeset",
    summary: (n) =>
      `lint-protected-paths: ${n} protected path(s) in changeset. Remove them or unprotect in project settings.`,
  });
}

/* v8 ignore next 6 */
if (isInvokedAsScript(import.meta.url)) {
  main(process.argv).catch((err) => {
    process.stderr.write(`lint-protected-paths: ${err.message ?? err}\n`);
    process.exit(2);
  });
}
