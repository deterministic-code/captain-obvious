#!/usr/bin/env node
import { writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import {
  isInvokedAsScript,
  readSourceOrNull,
  repoRootOf,
} from "../_kit/lint-shared.mjs";

/** Committed ratchet state: the per-metric coverage floor, at the repo root. */
const BASELINE_FILE = "coverage-baseline.json";
/** Where vitest's json-summary reporter writes current coverage. */
const SUMMARY_FILE = join("coverage", "coverage-summary.json");

const METRICS = ["lines", "statements", "functions", "branches"];
// v8 pct values carry two decimals; tolerate float noise below this.
const EPSILON = 0.01;
const CHECK_MODES = new Set(["--staged", "--push", "--all", "--files", "--warn"]);

function usage() {
  process.stderr.write(
    "Usage:\n" +
      "  node rules/lint-coverage/check.mjs --push|--staged|--all [--warn]\n" +
      "  node rules/lint-coverage/check.mjs --update   refresh coverage-baseline.json\n",
  );
}

/** Reduce one coverage-summary entry to `{ metric: pct }`. */
function pcts(entry) {
  const out = {};
  for (const m of METRICS) out[m] = entry[m].pct;
  return out;
}

/**
 * Read coverage/coverage-summary.json, re-keying per-file entries to repo-relative
 * paths so a baseline stays portable across checkouts. Throws when the report is
 * missing — a coverage gate that passes with no data is worse than useless.
 */
async function readSummary(repoRoot) {
  const raw = await readSourceOrNull(join(repoRoot, SUMMARY_FILE));
  if (raw == null) {
    throw new Error(
      `${SUMMARY_FILE} not found — run the test suite with coverage (e.g. npm test) first`,
    );
  }
  const parsed = JSON.parse(raw);
  const files = {};
  for (const [key, entry] of Object.entries(parsed)) {
    if (key === "total") continue;
    files[relative(repoRoot, key)] = pcts(entry);
  }
  return { total: pcts(parsed.total), files };
}

async function loadBaseline(repoRoot) {
  const raw = await readSourceOrNull(join(repoRoot, BASELINE_FILE));
  return raw == null ? null : JSON.parse(raw);
}

/**
 * Metrics where current coverage dropped below the baseline — total plus any
 * baselined file still present. A file absent from the current run (deleted or
 * renamed) is not a regression, so it is skipped rather than reported.
 */
export function findRegressions(baseline, current) {
  const out = [];
  const check = (scope, base, cur) => {
    if (!cur) return;
    for (const m of METRICS) {
      if (cur[m] + EPSILON < base[m]) {
        out.push({ scope, metric: m, baseline: base[m], current: cur[m] });
      }
    }
  };
  check("total", baseline.total, current.total);
  for (const [file, base] of Object.entries(baseline.files ?? {})) {
    check(file, base, current.files[file]);
  }
  return out;
}

function formatRegression(r) {
  return `coverage regressed: ${r.scope} ${r.metric} ${r.current.toFixed(2)}% < baseline ${r.baseline.toFixed(2)}%`;
}

export async function main(argv) {
  const args = argv.slice(2);
  const mode = args[0];
  const repoRoot = await repoRootOf(process.cwd());

  if (mode === "--update" || mode === "--add") {
    const current = await readSummary(repoRoot);
    await writeFile(
      join(repoRoot, BASELINE_FILE),
      `${JSON.stringify(current, null, 2)}\n`,
      "utf8",
    );
    process.stdout.write(
      `lint-coverage: baseline updated (total lines ${current.total.lines.toFixed(2)}%).\n`,
    );
    return;
  }
  if (!CHECK_MODES.has(mode)) {
    usage();
    process.exit(2);
  }

  const baseline = await loadBaseline(repoRoot);
  if (!baseline) {
    process.stdout.write(
      `lint-coverage: no ${BASELINE_FILE}; run with --update to establish one.\n`,
    );
    return;
  }
  const regressions = findRegressions(baseline, await readSummary(repoRoot));
  if (regressions.length === 0) {
    process.stdout.write("lint-coverage: no coverage regressions.\n");
    return;
  }
  for (const r of regressions) process.stderr.write(`${formatRegression(r)}\n`);
  process.stderr.write(
    `\nlint-coverage: ${regressions.length} coverage regression(s) below baseline. Add tests, or run --update to accept.\n`,
  );
  if (args.includes("--warn")) return;
  process.exit(1);
}

/* v8 ignore next 6 */
if (isInvokedAsScript(import.meta.url)) {
  main(process.argv).catch((err) => {
    process.stderr.write(`lint-coverage: ${err.message ?? err}\n`);
    process.exit(2);
  });
}
