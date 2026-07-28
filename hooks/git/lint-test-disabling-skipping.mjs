#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  formatViolation,
  isInvokedAsScript,
  listAllFiles,
  listStagedFiles,
  sanitizedGitEnv,
  stripStringsAndComments,
} from "./lint-shared.mjs";

const execFileAsync = promisify(execFile);

export const TEST_SUFFIX_RE =
  /\.(?:functional|integration)\.test\.(?:ts|tsx|mts|mjs|js|jsx)$|\.test\.(?:ts|tsx|mts|mjs|js|jsx)$|\.spec\.(?:ts|tsx|mts|mjs|js|jsx)$/;

const E2E_HELPER_RE =
  /(^|\/)frontend\/e2e\/(?:lib|fixtures)\/[^]*\.(?:ts|tsx|mts|mjs|js|jsx)$/;

export function tierOf(path) {
  const normalized = path.replace(/\\/g, "/").replace(/^\.?\/+/, "");
  if (
    /(^|\/)frontend\/e2e\/[^/]+\.spec\.(?:ts|tsx|mts|mjs|js|jsx)$/.test(
      normalized,
    )
  ) {
    return "e2e";
  }
  if (/\.functional\.test\.(?:ts|tsx|mts|mjs|js|jsx)$/.test(normalized)) {
    return "functional";
  }
  if (/\.integration\.test\.(?:ts|tsx|mts|mjs|js|jsx)$/.test(normalized)) {
    return "integration";
  }
  if (/\.test\.(?:ts|tsx|mts|mjs|js|jsx)$/.test(normalized)) {
    return "unit";
  }
  if (/\.spec\.(?:ts|tsx|mts|mjs|js|jsx)$/.test(normalized)) {
    return "spec-other";
  }
  if (E2E_HELPER_RE.test(normalized)) {
    return "e2e-helper";
  }
  return null;
}

const E2E_RULES = [
  {
    id: "page-request",
    re: /\bpage\.request\b/g,
    detail:
      "page.request.* is synthetic HTTP that bypasses the UI. e2e must drive real user actions (page.click / page.fill / page.goto) and observe via data-* attributes. See tester.md “E2E is the exact path a user takes”.",
  },
  {
    id: "page-route",
    re: /\bpage\.route\s*\(/g,
    detail:
      "page.route(...) mocks an endpoint; e2e must hit the real backend. Remove the mock; if the upstream is unreliable, this is integration, not e2e.",
  },
  {
    id: "page-evaluate",
    re: /\bpage\.evaluate\s*\(/g,
    detail:
      "page.evaluate(...) runs out-of-band code in the browser; e2e must assert on observable state produced by real user actions, not on harness injected via evaluate.",
  },
  {
    id: "test-use-storage-state",
    re: /\btest\.use\s*\(\s*\{[^}]*\bstorageState\b/g,
    detail:
      "test.use({ storageState ... }) bypasses the real login UI; e2e must drive the actual sign-in clickpath.",
  },
  {
    id: "test-fail",
    re: /\btest\.fail\s*\(/g,
    detail:
      "test.fail(...) marks a test as expected-failure. Fix the underlying bug; do not encode the failure as expected.",
  },
  {
    id: "retries",
    re: /\.retries\s*\(/g,
    detail:
      "Retries hide flakiness. Diagnose the root cause; no retry knob in e2e.",
  },
];

const FUNCTIONAL_RULES = [
  {
    id: "vi-mock",
    re: /\b(?:vi|jest)\.(?:mock|doMock)\s*\(/g,
    detail:
      "vi.mock / jest.mock in a functional test means this test is mocking what functional is supposed to exercise for real. Either drop the mock or rename the file to .integration.test.* and run it in the integration tier.",
  },
  {
    id: "set-timeout-numeric",
    re: /\bsetTimeout\s*\([^),]*,\s*[0-9][0-9_]*\s*[,)]/g,
    detail:
      "setTimeout(fn, <number>) is an arbitrary delay — it makes the test pass on speed, not correctness. Replace with a poll-until-observable helper (expect.poll, waitFor) that asserts on real state.",
  },
  {
    id: "sqlite-in-memory",
    // the lookbehind exempts expect(...).not.toContain('":memory:"') — asserting the string is ABSENT from emitted output is honest
    re: /(?<!\.not\.to(?:Contain|Match)\s*\(\s*[`"']{0,2})[`"']:memory:[`"']/g,
    useRaw: true,
    detail:
      "':memory:' sqlite databases belong to integration. Functional tests must hit a real DB container (Postgres / MySQL / Oracle / SqlServer) so the same code paths exercised in production are validated.",
  },
  {
    id: "negative-log-assert",
    re: /\.not\.(?:toContain|toMatch)\s*\(\s*[`'"](?:error|err|fail(?:ed|ure)?|exception|crash|panic)\b/gi,
    useRaw: true,
    detail:
      "expect(...).not.toContain('error'/'failed'/...) proves nothing — the absence of a substring is not the absence of a failure. Assert positive shape: expect(status).toBe('succeeded'), expect(rowCount).toBe(N), etc.",
  },
];

const UNIVERSAL_RULES = [
  {
    id: "skip-only-fixme",
    re: /\b(?:test|it|describe)\.(?:skip|only|fixme)\s*\(/g,
    detail:
      "Suppression markers (.skip / .only / .fixme) are forbidden. Only the human user can authorize removing or suppressing a test. Surface the failing case and fix the underlying bug.",
  },
  {
    id: "skip-if",
    re: /\b(?:test|it|describe)\.skipIf\s*\(/g,
    detail:
      ".skipIf(condition) is an env-var gate dressed as a function call — same silent-regression problem as .skip. Make the test always run, or fail loudly if the infrastructure is missing.",
  },
  {
    id: "x-prefix",
    re: /\b(?:xtest|xit|xdescribe)\s*\(/g,
    detail:
      "xtest / xit / xdescribe are suppression aliases of .skip. Forbidden for the same reason.",
  },
  {
    id: "focus-alias",
    re: /\b(?:fdescribe|fit)\s*\(/g,
    detail:
      "fdescribe / fit focus a subset and silently skip the rest of the suite — the same suppression as .only. Remove the focus.",
  },
  {
    id: "todo",
    re: /\b(?:test|it|describe)\.todo\b/g,
    detail:
      ".todo marks a test as planned-but-absent — it asserts nothing and can hide a missing test indefinitely. Write the test, or track it outside the suite.",
  },
  {
    id: "this-skip",
    re: /\bthis\.skip\s*\(/g,
    detail:
      "this.skip() suppresses a test at runtime — a silent skip. Make the test always run, or fail loudly when its prerequisites are missing.",
  },
];

const RULE_SETS = {
  e2e: [...E2E_RULES, ...UNIVERSAL_RULES],
  functional: [...FUNCTIONAL_RULES, ...UNIVERSAL_RULES],
  integration: [...UNIVERSAL_RULES],
  unit: [...UNIVERSAL_RULES],
  "spec-other": [...FUNCTIONAL_RULES, ...UNIVERSAL_RULES],
  "e2e-helper": [...UNIVERSAL_RULES],
};

// ratchet-only variants are wider than the tier rules: bare property access (incl. .skipIf) and vi.spyOn count as regressions even in tiers where the absolute layer permits them
const RATCHET_ONLY_MARKERS = [
  {
    id: "skip-marker",
    re: /\b(?:test|it|describe)\.(?:skip|only|fixme|skipIf)\b/g,
    label: ".skip / .only / .fixme / .skipIf",
  },
  {
    id: "mock",
    re: /\b(?:vi|jest)\.(?:mock|doMock|spyOn)\s*\(/g,
    label: "vi.mock / jest.mock / vi.spyOn",
  },
];

const RATCHET_RULE_IDS = new Set([
  "x-prefix",
  "focus-alias",
  "todo",
  "this-skip",
  "page-request",
  "page-route",
  "page-evaluate",
  "set-timeout-numeric",
  "negative-log-assert",
  "test-fail",
  "retries",
]);

export const FORBIDDEN_MARKERS = [
  ...RATCHET_ONLY_MARKERS,
  ...[...E2E_RULES, ...FUNCTIONAL_RULES, ...UNIVERSAL_RULES]
    .filter((r) => RATCHET_RULE_IDS.has(r.id))
    .map((r) => ({ id: r.id, re: r.re, label: r.id, useRaw: r.useRaw })),
];

export function countMarkers(src) {
  if (!src) return Object.fromEntries(FORBIDDEN_MARKERS.map((m) => [m.id, 0]));
  const stripped = stripStringsAndComments(src);
  const counts = {};
  for (const marker of FORBIDDEN_MARKERS) {
    const haystack = marker.useRaw === true ? src : stripped;
    marker.re.lastIndex = 0;
    let n = 0;
    while (marker.re.exec(haystack) !== null) n++;
    counts[marker.id] = n;
  }
  return counts;
}

export function diffMarkers(before, after) {
  const a = countMarkers(before);
  const b = countMarkers(after);
  const regressions = [];
  for (const marker of FORBIDDEN_MARKERS) {
    // Dead defaults: countMarkers seeds every FORBIDDEN_MARKERS id to 0, so the ?? 0 fallbacks never fire.
    /* v8 ignore next 2 */
    const oldCount = a[marker.id] ?? 0;
    const newCount = b[marker.id] ?? 0;
    if (newCount > oldCount) {
      regressions.push({
        id: marker.id,
        label: marker.label,
        oldCount,
        newCount,
        delta: newCount - oldCount,
      });
    }
  }
  return regressions;
}

export function findViolations(src, tier) {
  const rules = RULE_SETS[tier];
  if (!rules) return [];
  const stripped = stripStringsAndComments(src);
  const violations = [];
  for (const rule of rules) {
    const haystack = rule.useRaw ? src : stripped;
    rule.re.lastIndex = 0;
    let m;
    while ((m = rule.re.exec(haystack)) !== null) {
      const idx = m.index;
      const line = src.slice(0, idx).split("\n").length;
      const col = idx - src.lastIndexOf("\n", idx - 1);
      violations.push({ line, col, kind: rule.id, detail: rule.detail });
    }
  }
  for (const v of findNoOpExpectCalls(stripped, src)) violations.push(v);
  violations.sort((a, b) =>
    a.line === b.line ? a.col - b.col : a.line - b.line,
  );
  return violations;
}

const EXPECT_NO_MATCHER_DETAIL =
  "expect(actual, ...) with no chained matcher (.toBe/.toMatch/.toEqual/.toThrow/etc.) is a no-op — vitest's second arg is a hint, not an assertion. Add a matcher or delete the line.";

function scanExpectArgs(src, openIdx) {
  let depth = 1;
  let nested = 0;
  let hasTopLevelComma = false;
  let i = openIdx;
  for (; i < src.length && depth > 0; i++) {
    const ch = src[i];
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    else if (ch === "[" || ch === "{") nested++;
    else if (ch === "]" || ch === "}") nested--;
    else if (ch === "," && depth === 1 && nested === 0) hasTopLevelComma = true;
  }
  return { endIdx: i, hasTopLevelComma };
}

function findNoOpExpectCalls(strippedSrc, rawSrc) {
  const violations = [];
  const re = /\bexpect\(/g;
  let m;
  while ((m = re.exec(strippedSrc)) !== null) {
    const { endIdx, hasTopLevelComma } = scanExpectArgs(
      strippedSrc,
      m.index + m[0].length,
    );
    if (!hasTopLevelComma) continue;
    let j = endIdx;
    while (j < strippedSrc.length && /\s/.test(strippedSrc[j])) j++;
    if (strippedSrc[j] === ".") continue;
    const idx = m.index;
    const line = rawSrc.slice(0, idx).split("\n").length;
    const col = idx - rawSrc.lastIndexOf("\n", idx - 1);
    violations.push({
      line,
      col,
      kind: "expect-no-matcher",
      detail: EXPECT_NO_MATCHER_DETAIL,
    });
  }
  return violations;
}

export async function lintFile(path, cwd) {
  const tier = tierOf(path);
  if (!tier) return [];
  const absPath = cwd ? resolve(cwd, path) : path;
  let src;
  try {
    src = await readFile(absPath, "utf8");
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
  return findViolations(src, tier).map((v) => ({ ...v, path }));
}

export { formatViolation };

function isInScope(path) {
  const normalized = path.replace(/\\/g, "/");
  return TEST_SUFFIX_RE.test(normalized) || E2E_HELPER_RE.test(normalized);
}

async function listStagedTestFiles(cwd) {
  const { stdout } = await execFileAsync(
    "git",
    ["diff", "--cached", "--name-status", "--diff-filter=ACMR"],
    { encoding: "utf8", cwd, env: sanitizedGitEnv() },
  );
  const out = [];
  for (const line of stdout.split("\n")) {
    if (!line) continue;
    const [status, ...rest] = line.split(/\s+/);
    const path = rest[rest.length - 1];
    // Unreachable: git never emits a whitespace-only name-status line.
    /* v8 ignore next */
    if (!path) continue;
    if (!TEST_SUFFIX_RE.test(path)) continue;
    out.push({ status, path });
  }
  return out;
}

async function readFromGit(ref, path, cwd) {
  try {
    const { stdout } = await execFileAsync("git", ["show", `${ref}:${path}`], {
      encoding: "utf8",
      cwd,
      env: sanitizedGitEnv(),
      maxBuffer: 64 * 1024 * 1024,
    });
    return stdout;
  } catch (err) {
    // Dead: git-show failures always carry code 128, so the || is always true — the extra operands, the else-branch, and the throw are unreachable (v8 cannot exclude the else-branch without enclosing the lone reachable return null).
    /* v8 ignore start */
    if (
      err.code === 128 ||
      /exists on disk, but not in/i.test(err.stderr ?? "") ||
      /does not exist/i.test(err.stderr ?? "")
    ) {
      return null;
    }
    throw err;
  }
  /* v8 ignore stop */
}

async function collectRatchetReports(cwd) {
  const entries = await listStagedTestFiles(cwd);
  const reports = [];
  for (const entry of entries) {
    if (entry.status === "A" || entry.status === "D") continue;
    const before = await readFromGit("HEAD", entry.path, cwd);
    const after = await readFromGit("", entry.path, cwd);
    if (before == null || after == null) continue;
    const regressions = diffMarkers(before, after);
    if (regressions.length > 0) reports.push({ path: entry.path, regressions });
  }
  return reports;
}

async function selectFiles(mode, args, cwd) {
  if (mode === "--staged") return listStagedFiles(cwd);
  if (mode === "--all") return listAllFiles(cwd);
  if (mode === "--files") return args.slice(1);
  process.stderr.write(
    "Usage:\n  node scripts/hooks/lint-test-disabling-skipping.mjs --staged\n  node scripts/hooks/lint-test-disabling-skipping.mjs --all\n  node scripts/hooks/lint-test-disabling-skipping.mjs --files <path> [...]\n",
  );
  process.exit(2);
}

function reportClean(mode) {
  if (mode === "--staged") {
    process.stdout.write(
      "lint-test-disabling-skipping: no synthetic test patterns and no honesty regressions in staged diff.\n",
    );
  } else if (mode === "--all") {
    process.stdout.write(
      "lint-test-disabling-skipping: no synthetic test patterns in repo.\n",
    );
  }
}

function reportProblems(violations, ratchetReports) {
  for (const v of violations) process.stderr.write(`${formatViolation(v)}\n`);
  for (const r of ratchetReports) {
    process.stderr.write(`${r.path}\n`);
    for (const reg of r.regressions) {
      process.stderr.write(
        `  + ${reg.label}: ${reg.oldCount} -> ${reg.newCount} (+${reg.delta})\n`,
      );
    }
  }
  if (violations.length > 0)
    process.stderr.write(
      `\nlint-test-disabling-skipping: ${violations.length} violation(s). Rule: e2e drives real UI; functional spawns real binaries; no test may be silently suppressed. See .claude/agents/tester.md.\n`,
    );
  if (ratchetReports.length > 0)
    process.stderr.write(
      `\nlint-test-disabling-skipping: ${ratchetReports.length} modified test file(s) regressed honesty markers. Rule: an edit may not add suppression markers (.skip / mocks / page.request / setTimeout / negative assertions / retries) to an existing test file. Fix the production code instead, or surface the rewrite to the human user for explicit authorization.\n`,
    );
}

export async function main(argv, opts = {}) {
  const cwd = opts.cwd;
  const args = argv.slice(2);
  const mode = args[0];
  const files = await selectFiles(mode, args, cwd);
  const targets = files.filter(isInScope);
  const violations = (
    await Promise.all(targets.map((p) => lintFile(p, cwd)))
  ).flat();
  const ratchetReports =
    mode === "--staged" ? await collectRatchetReports(cwd) : [];
  if (violations.length === 0 && ratchetReports.length === 0) {
    reportClean(mode);
    return;
  }
  reportProblems(violations, ratchetReports);
  process.exit(1);
}

/* v8 ignore next 8 */
if (isInvokedAsScript(import.meta.url)) {
  main(process.argv).catch((err) => {
    process.stderr.write(
      `lint-test-disabling-skipping: ${err.message ?? err}\n`,
    );
    process.exit(2);
  });
}
