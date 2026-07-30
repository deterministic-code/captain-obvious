#!/usr/bin/env node
import {
  isInvokedAsScript,
  lintFileWith,
  runFileHook,
  stripStringsAndComments,
} from "@deterministic-code/co-rule-kit/lint-shared";

// Test files this rule scans. (Mirrors the subject-matcher in lint-tests-with-code;
// kept local because the two rules ship independently.)
const TEST_FILE_RE = /\.(?:test|spec)\.(?:ts|tsx|mts|cts|mjs|cjs|js|jsx)$/;
const TEST_CALL_RE = /\b(?:it|test)\s*\(/g;
// Anything that actually asserts. Broad on purpose: matcher chains, thrown-checks,
// promise matchers, and node:assert all count.
const ASSERTION_RE =
  /\bexpect\s*\(|\bexpect\.|\bassert\b|\.(?:toThrow|toReject|resolves|rejects)\b/;
const CALLBACK_RE = /=>|\bfunction\b/;

function isTestFile(path) {
  return TEST_FILE_RE.test(path.replace(/\\/g, "/"));
}

/** Index of the `)` that closes the `(` at openIdx (parens only; strings pre-stripped). */
function matchParen(src, openIdx) {
  let depth = 0;
  for (let i = openIdx; i < src.length; i++) {
    if (src[i] === "(") depth++;
    else if (src[i] === ")" && --depth === 0) return i;
  }
  return src.length;
}

function at(src, idx, kind, detail) {
  const line = src.slice(0, idx).split("\n").length;
  return { line, col: idx - src.lastIndexOf("\n", idx - 1), kind, detail };
}

/**
 * Tests that assert nothing: an it()/test() with no callback (a pending stub), or
 * a callback body with no assertion. Such a test passes vacuously and gives false
 * confidence. Nested calls are skipped past so each it/test is judged once.
 */
export function findEmptyTests(src) {
  const stripped = stripStringsAndComments(src);
  const out = [];
  TEST_CALL_RE.lastIndex = 0;
  let m;
  while ((m = TEST_CALL_RE.exec(stripped)) !== null) {
    const open = m.index + m[0].length - 1;
    const close = matchParen(stripped, open);
    const inner = stripped.slice(open + 1, close);
    if (!CALLBACK_RE.test(inner)) {
      out.push(
        at(src, m.index, "test-no-body", "it()/test() has no callback — a pending stub asserts nothing."),
      );
    } else if (!ASSERTION_RE.test(inner)) {
      out.push(
        at(src, m.index, "test-no-assertion", "test body has no assertion (expect/assert) — it passes vacuously."),
      );
    }
    TEST_CALL_RE.lastIndex = close;
  }
  return out;
}

function usage() {
  process.stderr.write(
    "Usage:\n  node rules/lint-empty-tests/check.mjs --staged|--all|--files <path>... [--warn]\n",
  );
}

export function main(argv) {
  return runFileHook(argv, {
    usage,
    collect: (path) =>
      isTestFile(path) ? lintFileWith(path, undefined, findEmptyTests) : [],
    okLine: "lint-empty-tests: no empty or assertion-free tests",
    summary: (n) =>
      `lint-empty-tests: ${n} empty or assertion-free test(s). Every it()/test() needs a body that asserts (expect/assert).`,
  });
}

/* v8 ignore next 6 */
if (isInvokedAsScript(import.meta.url)) {
  main(process.argv).catch((err) => {
    process.stderr.write(`lint-empty-tests: ${err.message ?? err}\n`);
    process.exit(2);
  });
}
