#!/usr/bin/env node
import {
  formatViolation,
  isInvokedAsScript,
  isLintable,
  lintFileWith,
  runFileHook,
} from "./lint-shared.mjs";

export const MAX_LINE_LENGTH = 100;

export function findViolations(src, limit = MAX_LINE_LENGTH) {
  const violations = [];
  src.split("\n").forEach((raw, i) => {
    // Measure the logical line: a trailing \r from CRLF files is not a column.
    const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    if (line.length > limit) {
      violations.push({
        line: i + 1,
        col: limit + 1,
        kind: "max-line-length",
        detail: `line is ${line.length} columns (limit ${limit})`,
      });
    }
  });
  return violations;
}

export const lintFile = (path, cwd) => lintFileWith(path, cwd, findViolations);

export { formatViolation };

function usage() {
  process.stderr.write(
    "Usage:\n  node scripts/hooks/lint-max-line-length.mjs --staged [--warn]\n  node scripts/hooks/lint-max-line-length.mjs --all [--warn]\n  node scripts/hooks/lint-max-line-length.mjs --files <path> [...] [--warn]\n",
  );
}

export function main(argv) {
  return runFileHook(argv, {
    usage,
    collect: (path) => (isLintable(path) ? lintFile(path) : []),
    okLine: "lint-max-line-length: no overlong lines",
    summary: (n) =>
      `lint-max-line-length: ${n} line(s) over the ${MAX_LINE_LENGTH}-column limit — wrap or shorten them.`,
  });
}

/* v8 ignore next 6 */
if (isInvokedAsScript(import.meta.url)) {
  main(process.argv).catch((err) => {
    process.stderr.write(`lint-max-line-length: ${err.message ?? err}\n`);
    process.exit(2);
  });
}
