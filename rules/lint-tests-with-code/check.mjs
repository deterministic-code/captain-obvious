#!/usr/bin/env node
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  isInvokedAsScript,
  isLintable,
  sanitizedGitEnv,
} from "../_kit/lint-shared.mjs";

const execFileAsync = promisify(execFile);

// Any unit/spec test file. Deliberately simpler than the tier-aware regex in
// lint-test-disabling-skipping — here we only need "is this the test for X".
const TEST_FILE_RE = /\.(?:test|spec)\.(?:ts|tsx|mts|cts|mjs|cjs|js|jsx)$/;
// Production source a test should move with. Barrels and type-only files carry
// no behavior to test, so they are out of scope.
const SCOPE_RE = /^(?:src|hooks|lib)\//;
const NON_LOGIC_RE = /(?:^|\/)(?:index|types)\.[^/]+$|\.d\.ts$/;

function norm(path) {
  return path.replace(/\\/g, "/").replace(/^\.?\/+/, "");
}

export function isTestFile(path) {
  return TEST_FILE_RE.test(norm(path));
}

export function isProdSource(path) {
  const p = norm(path);
  return SCOPE_RE.test(p) && isLintable(p) && !isTestFile(p) && !NON_LOGIC_RE.test(p);
}

/** What a file is "about": strip the test/tier suffix, or the plain extension. */
export function subjectOf(path) {
  const base = norm(path).split("/").pop();
  return base.replace(TEST_FILE_RE, "").replace(/\.[^.]+$/, "");
}

/**
 * Production files in the change set whose subject has no test file changing
 * alongside it — the deterministic proxy for "no code without a test". This is
 * not literal test-first (a commit hook can't observe authoring order), but it
 * blocks shipping a source change with no corresponding test change.
 */
export function findUntested(changes) {
  const testedSubjects = new Set(
    changes.filter((c) => isTestFile(c.path)).map((c) => subjectOf(c.path)),
  );
  const out = [];
  for (const c of changes) {
    if (!isProdSource(c.path)) continue;
    if (testedSubjects.has(subjectOf(c.path))) continue;
    out.push({ path: c.path, status: c.status });
  }
  return out;
}

async function listStagedChanges(cwd) {
  const { stdout } = await execFileAsync(
    "git",
    ["diff", "--cached", "--name-status", "--diff-filter=ACMR"],
    { encoding: "utf8", cwd, env: sanitizedGitEnv() },
  );
  const out = [];
  for (const line of stdout.split("\n")) {
    if (!line) continue;
    const parts = line.split(/\s+/);
    out.push({ status: parts[0][0], path: parts[parts.length - 1] });
  }
  return out;
}

function usage() {
  process.stderr.write(
    "Usage:\n  node rules/lint-tests-with-code/check.mjs --staged [--warn]\n",
  );
}

export async function main(argv, opts = {}) {
  const args = argv.slice(2);
  const mode = args[0];
  if (mode !== "--staged") {
    usage();
    process.exit(2);
  }
  const untested = findUntested(await listStagedChanges(opts.cwd));
  if (untested.length === 0) {
    process.stdout.write(
      "lint-tests-with-code: every changed source file moves with a test.\n",
    );
    return;
  }
  for (const u of untested) {
    const why =
      u.status === "A" ? "new file has no test" : "changed without touching its test";
    process.stderr.write(
      `${u.path}: ${why} (expected a ${subjectOf(u.path)}.test.* change in this commit)\n`,
    );
  }
  process.stderr.write(
    `\nlint-tests-with-code: ${untested.length} source change(s) with no matching test change. Write or adjust the test in the same commit, or stage it alongside.\n`,
  );
  if (args.includes("--warn")) return;
  process.exit(1);
}

/* v8 ignore next 6 */
if (isInvokedAsScript(import.meta.url)) {
  main(process.argv).catch((err) => {
    process.stderr.write(`lint-tests-with-code: ${err.message ?? err}\n`);
    process.exit(2);
  });
}
