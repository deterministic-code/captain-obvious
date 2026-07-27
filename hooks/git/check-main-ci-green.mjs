#!/usr/bin/env node
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { isInvokedAsScript } from "./lint-shared.mjs";

const execFileAsync = promisify(execFile);

export const BLOCKING_JOBS = ["unit", "integration"];
const FAILING_JOB_CONCLUSIONS = new Set([
  "failure",
  "timed_out",
  "startup_failure",
]);

// null means the job list is unknown — callers must treat the run failure as blocking
export function blockingJobFailures(jobs) {
  if (!Array.isArray(jobs)) return null;
  return jobs
    .filter(
      (j) =>
        BLOCKING_JOBS.includes(j.name) &&
        FAILING_JOB_CONCLUSIONS.has(j.conclusion),
    )
    .map((j) => j.name);
}

async function fetchRunJobs(databaseId) {
  let stdout;
  try {
    ({ stdout } = await execFileAsync("gh", [
      "run",
      "view",
      String(databaseId),
      "--json",
      "jobs",
    ]));
  } catch (err) {
    process.stderr.write(
      `check-main-ci-green: gh run view failed (${err.code ?? err.message}) — treating the run failure as blocking.\n`,
    );
    return null;
  }
  try {
    return JSON.parse(stdout).jobs;
  } catch (err) {
    // Unreachable throw: JSON.parse only throws SyntaxError, so the non-SyntaxError rethrow is dead.
    /* v8 ignore next */
    if (!(err instanceof SyntaxError)) throw err;
    return null;
  }
}

// cancelled runs are queue-displaced non-verdicts; only success/failure counts
export function pickVerdict(runs) {
  if (!Array.isArray(runs)) return null;
  return (
    runs.find(
      (r) => r.conclusion === "success" || r.conclusion === "failure",
    ) ?? null
  );
}

export async function fetchMainTestsVerdict() {
  let stdout;
  try {
    ({ stdout } = await execFileAsync("gh", [
      "run",
      "list",
      "--workflow",
      "Tests",
      "--branch",
      "main",
      "--limit",
      "20",
      "--json",
      "conclusion,databaseId,displayTitle,url",
    ]));
  } catch (err) {
    return {
      verdict: null,
      unavailable: `gh run list failed: ${err.code ?? err.message}`,
    };
  }
  let runs;
  try {
    runs = JSON.parse(stdout);
  } catch (err) {
    // Unreachable throw: JSON.parse only throws SyntaxError, so the non-SyntaxError rethrow is dead.
    /* v8 ignore next */
    if (!(err instanceof SyntaxError)) throw err;
    return { verdict: null, unavailable: "gh returned non-JSON output" };
  }
  const verdict = pickVerdict(runs);
  if (!verdict || verdict.conclusion !== "failure") {
    return { verdict, unavailable: null };
  }
  const failedJobs = blockingJobFailures(
    await fetchRunJobs(verdict.databaseId),
  );
  if (failedJobs !== null && failedJobs.length === 0) {
    return {
      verdict: { ...verdict, conclusion: "non-blocking-failure" },
      unavailable: null,
    };
  }
  return { verdict, unavailable: null };
}

export async function main(argv, opts = {}) {
  const env = opts.env ?? process.env;
  const mode = argv[2];
  if (mode === "--blocking-jobs") {
    process.stdout.write(BLOCKING_JOBS.join("\n") + "\n");
    return;
  }
  const { verdict, unavailable } = await fetchMainTestsVerdict();
  if (mode === "--verdict") {
    if (verdict) {
      process.stdout.write(
        `${verdict.conclusion}\t${verdict.displayTitle}\t${verdict.url}\n`,
      );
    }
    return;
  }
  if (unavailable) {
    process.stdout.write(
      `check-main-ci-green: verdict unavailable (${unavailable}) — allowing commit; verify main CI manually.\n`,
    );
    return;
  }
  if (verdict === null) {
    process.stdout.write(
      "check-main-ci-green: no completed Tests run found on main — allowing commit.\n",
    );
    return;
  }
  if (verdict.conclusion === "non-blocking-failure") {
    process.stdout.write(
      `check-main-ci-green: main Tests run failed only outside the blocking unit/integration jobs (${verdict.url}) — allowing commit.\n`,
    );
    return;
  }
  if (verdict.conclusion === "failure") {
    if (env.ALLOW_COMMIT_ON_RED_MAIN === "1") {
      process.stdout.write(
        `check-main-ci-green: main is RED (${verdict.url}) — ALLOW_COMMIT_ON_RED_MAIN=1 accepted; this commit must be part of the fix.\n`,
      );
      return;
    }
    process.stderr.write(
      `BLOCKED: the latest completed Tests run on main FAILED.\n  ${verdict.displayTitle}\n  ${verdict.url}\nFixing main takes priority over new work — do not commit unrelated changes onto a red main. If this commit IS part of the fix for that failure, re-run as: ALLOW_COMMIT_ON_RED_MAIN=1 git commit ... and tell the user you used the override.\n`,
    );
    process.exit(1);
  }
  process.stdout.write("check-main-ci-green: main Tests run is green.\n");
}

/* v8 ignore next 6 */
if (isInvokedAsScript(import.meta.url)) {
  main(process.argv).catch((err) => {
    process.stderr.write(`check-main-ci-green: ${err.message ?? err}\n`);
    process.exit(2);
  });
}
