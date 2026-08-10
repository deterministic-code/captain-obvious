#!/usr/bin/env node
// Governance rule runner: run the project's test suite (via a configurable shell
// command) and block commit/push when it fails. Test command and timeout come
// from the rule's config (settings panel / CLI), read through config-bridge.
// Bypass for one invocation: ALLOW_COMMIT_ON_RED_TESTS=1.
import { exec } from "node:child_process";
import {
  isInvokedAsScript,
  sanitizedGitEnv,
} from "@deterministic-code/co-rule-kit/lint-shared";
import { ruleConfig } from "@deterministic-code/co-rule-kit/config-bridge";

const DEFAULT_TEST_COMMAND = "npm test";
const DEFAULT_TIMEOUT_MS = 600000;

function runTests(command, cwd, env, timeoutMs) {
  return new Promise((done) => {
    exec(
      command,
      { cwd, env, timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (!err) {
          done({ ok: true, stdout, stderr });
          return;
        }
        done({
          ok: false,
          stdout,
          stderr,
          timedOut: err.killed === true && err.signal != null,
          notFound: err.code === 127,
          code: err.code ?? null,
        });
      },
    );
  });
}

export async function main(argv, opts = {}) {
  const env = opts.env ?? sanitizedGitEnv();
  const cwd = opts.cwd ?? process.cwd();
  const resolveConfig = opts.resolveConfig ?? ruleConfig;

  if (env.ALLOW_COMMIT_ON_RED_TESTS === "1") {
    process.stdout.write(
      "gov-tests-green: ALLOW_COMMIT_ON_RED_TESTS=1 accepted — skipping the test suite.\n",
    );
    return;
  }

  const config = (await resolveConfig("gov-tests-green")) ?? {};
  const testCommand = config.testCommand ?? DEFAULT_TEST_COMMAND;
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  process.stdout.write(`gov-tests-green: running \`${testCommand}\`...\n`);
  const result = await runTests(testCommand, cwd, env, timeoutMs);

  if (result.ok) {
    process.stdout.write("gov-tests-green: tests passed.\n");
    return;
  }

  if (result.timedOut) {
    process.stderr.write(
      `BLOCKED: \`${testCommand}\` did not finish within ${timeoutMs}ms and was killed. Raise the timeout in this rule's settings or speed up the suite. Bypass for one invocation: ALLOW_COMMIT_ON_RED_TESTS=1.\n`,
    );
    process.exit(1);
  }

  if (result.notFound) {
    process.stderr.write(
      `BLOCKED: \`${testCommand}\` could not be run (command not found). Check the test command configured for this rule. Bypass for one invocation: ALLOW_COMMIT_ON_RED_TESTS=1.\n`,
    );
    process.exit(1);
  }

  if (result.stdout) process.stderr.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  process.stderr.write(
    `\nBLOCKED: \`${testCommand}\` failed (exit code ${result.code ?? "unknown"}). Fix the failing tests before committing/pushing. Bypass for one invocation: ALLOW_COMMIT_ON_RED_TESTS=1.\n`,
  );
  process.exit(1);
}

/* v8 ignore next 6 */
if (isInvokedAsScript(import.meta.url)) {
  main(process.argv).catch((err) => {
    process.stderr.write(`gov-tests-green: ${err.message ?? err}\n`);
    process.exit(2);
  });
}
