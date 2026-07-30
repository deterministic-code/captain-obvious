#!/usr/bin/env node
import {
  formatViolation,
  isInvokedAsScript,
  isLintable,
  lintFileWith,
  runFileHook,
} from "./lint-shared.mjs";

export const MAX_FILE_LINES = 300;

/** Physical line count, ignoring the final newline so `a\nb\n` counts as 2, not 3. */
export function lineCount(src) {
  if (src === "") return 0;
  const n = src.split("\n").length;
  return src.endsWith("\n") ? n - 1 : n;
}

export function findViolations(src, limit = MAX_FILE_LINES) {
  const count = lineCount(src);
  if (count <= limit) return [];
  return [
    {
      line: limit + 1,
      col: 1,
      kind: "max-file-lines",
      detail: `file has ${count} lines (limit ${limit})`,
    },
  ];
}

export const lintFile = (path, cwd) => lintFileWith(path, cwd, findViolations);


function usage() {
  process.stderr.write(
    "Usage:\n  node scripts/hooks/lint-max-file-lines.mjs --staged [--warn]\n  node scripts/hooks/lint-max-file-lines.mjs --all [--warn]\n  node scripts/hooks/lint-max-file-lines.mjs --files <path> [...] [--warn]\n",
  );
}

export function main(argv) {
  return runFileHook(argv, {
    usage,
    collect: (path) => (isLintable(path) ? lintFile(path) : []),
    okLine: "lint-max-file-lines: no oversized files",
    summary: (n) =>
      `lint-max-file-lines: ${n} file(s) over the ${MAX_FILE_LINES}-line limit — split each module into focused units.`,
  });
}

/* v8 ignore next 6 */
if (isInvokedAsScript(import.meta.url)) {
  main(process.argv).catch((err) => {
    process.stderr.write(`lint-max-file-lines: ${err.message ?? err}\n`);
    process.exit(2);
  });
}
