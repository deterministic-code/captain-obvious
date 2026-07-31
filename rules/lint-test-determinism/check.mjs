#!/usr/bin/env node
import {
  isInvokedAsScript,
  lintFileWith,
  runFileHook,
  stripStringsAndComments,
} from "@deterministic-code/co-rule-kit/lint-shared";

const TEST_FILE_RE = /\.(?:test|spec)\.(?:ts|tsx|mts|cts|mjs|cjs|js|jsx)$/;

// Sources of nondeterminism a test must not read directly. Timers (setTimeout)
// are deliberately absent: fake-timer setups legitimately call them, so flagging
// them would be mostly false positives.
const MARKERS = [
  {
    id: "date-now",
    re: /\bDate\.now\s*\(/g,
    detail:
      "Date.now() is wall-clock time — nondeterministic. Inject a clock or assert against a fixed timestamp.",
  },
  {
    id: "new-date-now",
    re: /\bnew\s+Date\s*\(\s*\)/g,
    detail:
      "new Date() reads the current time. Construct from an explicit value (new Date(0), new Date('2020-01-01')).",
  },
  {
    id: "performance-now",
    re: /\bperformance\.now\s*\(/g,
    detail: "performance.now() is a live timer — nondeterministic in a test.",
  },
  {
    id: "math-random",
    re: /\bMath\.random\s*\(/g,
    detail:
      "Math.random() makes the test nondeterministic. Seed a PRNG or use fixed values.",
  },
  {
    id: "network-fetch",
    re: /\bfetch\s*\(/g,
    detail:
      "fetch() hits the network — nondeterministic and slow. Stub the boundary and assert on your code.",
  },
  {
    id: "network-xhr",
    re: /\bnew\s+XMLHttpRequest\s*\(/g,
    detail:
      "XMLHttpRequest performs real network I/O in a test. Stub the boundary.",
  },
];

function isTestFile(path) {
  return TEST_FILE_RE.test(path.replace(/\\/g, "/"));
}

export function findViolations(src) {
  const stripped = stripStringsAndComments(src);
  const out = [];
  for (const marker of MARKERS) {
    marker.re.lastIndex = 0;
    let m;
    while ((m = marker.re.exec(stripped)) !== null) {
      const idx = m.index;
      out.push({
        line: src.slice(0, idx).split("\n").length,
        col: idx - src.lastIndexOf("\n", idx - 1),
        kind: marker.id,
        detail: marker.detail,
      });
    }
  }
  return out.sort((a, b) =>
    a.line === b.line ? a.col - b.col : a.line - b.line,
  );
}

function usage() {
  process.stderr.write(
    "Usage:\n  node rules/lint-test-determinism/check.mjs --staged|--all|--files <path>... [--warn]\n",
  );
}

export function main(argv) {
  return runFileHook(argv, {
    usage,
    collect: (path) =>
      isTestFile(path) ? lintFileWith(path, undefined, findViolations) : [],
    okLine: "lint-test-determinism: no nondeterministic sources in tests",
    summary: (n) =>
      `lint-test-determinism: ${n} nondeterministic source(s) in tests (time/random/network). Make tests deterministic — inject clocks, seed randomness, stub the network.`,
  });
}

/* v8 ignore next 6 */
if (isInvokedAsScript(import.meta.url)) {
  main(process.argv).catch((err) => {
    process.stderr.write(`lint-test-determinism: ${err.message ?? err}\n`);
    process.exit(2);
  });
}
