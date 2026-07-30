#!/usr/bin/env node
import { extname, isAbsolute, relative, resolve } from "node:path";
import {
  collectAddedRanges,
  rangesOverlap,
  reportRatchetViolations,
  runRatchetHook,
} from "@deterministic-code/co-rule-kit/dup-ratchet";
import {
  cloneClusters,
  subtreesForFile,
  tableViolationsForFile,
} from "@deterministic-code/co-rule-kit/dup-structural-metrics";
import {
  emitJson,
  formatViolation,
  isExcluded,
  isInvokedAsScript,
  jsonMode,
  listAllFiles,
} from "@deterministic-code/co-rule-kit/lint-shared";
import { JS_TS_EXTS } from "@deterministic-code/captain-obvious/languages";

const GENERATED_PARTS = [
  "/samples/",
  "/migrations/",
  "/generated/",
  "/version-",
];

export function isStructuralFile(path) {
  if (!JS_TS_EXTS.has(extname(path))) return false;
  if (isExcluded(path)) return false;
  const normalized = `/${path.replace(/^\.?\/+/, "")}`;
  return !GENERATED_PARTS.some((p) => normalized.includes(p));
}

function toRepoRelative(name, repoRoot) {
  return isAbsolute(name) ? relative(repoRoot, name) : name;
}

async function ratchetViolations(repoRoot, targets, diffArgs) {
  const addedRanges = await collectAddedRanges(repoRoot, targets, diffArgs);
  const violations = [];
  for (const path of targets) {
    const added = addedRanges.get(path) ?? [];
    const found = await tableViolationsForFile(resolve(repoRoot, path));
    for (const v of found) {
      if (rangesOverlap([v.line, v.line], added)) {
        violations.push({ ...v, path });
      }
    }
  }
  return violations;
}

async function ratchetGate({ repoRoot, changedFiles, diffArgs, label, warn }) {
  const targets = changedFiles.filter(isStructuralFile);
  if (targets.length === 0) {
    process.stdout.write(`lint-dup-structural: no ${label} code files.\n`);
    return;
  }
  const violations = await ratchetViolations(repoRoot, targets, diffArgs);
  const n = violations.length;
  reportRatchetViolations(violations, {
    okLine: `lint-dup-structural: no newly-introduced sibling duplication in ${label}.`,
    summaryLine: `\nlint-dup-structural: ${n} newly-introduced sibling-duplication table(s). Collapse to a data table + factory in this same change.`,
    warnLine: warn
      ? `\n⚠ lint-dup-structural: ${n} newly-introduced sibling-duplication table(s) — collapse to a data table + factory (advisory — not blocking this push yet).`
      : undefined,
  });
}

async function runAllMode(repoRoot) {
  const files = (await listAllFiles(repoRoot)).filter(isStructuralFile);
  const tables = [];
  const subtreesByFile = [];
  for (const path of files) {
    const abs = resolve(repoRoot, path);
    tables.push(
      ...(await tableViolationsForFile(abs)).map((v) => ({ ...v, path })),
    );
    subtreesByFile.push(await subtreesForFile(abs));
  }
  const clusters = cloneClusters(subtreesByFile, {});
  if (jsonMode()) {
    return emitJson([
      ...tables,
      ...clusters.map((c) => clusterViolation(c, repoRoot)),
    ]);
  }
  for (const v of tables) process.stdout.write(`${formatViolation(v)}\n`);
  for (const cluster of clusters) {
    process.stdout.write(
      `clone cluster (${cluster[0].nodeCount} nodes)  ${clusterLocs(cluster, repoRoot)}\n`,
    );
  }
  process.stdout.write(
    `\nlint-dup-structural: ${tables.length} sibling table(s), ${clusters.length} clone cluster(s) (report-only; --push is the ratchet gate).\n`,
  );
}

function clusterLocs(cluster, repoRoot) {
  return cluster
    .map((c) => `${toRepoRelative(c.path, repoRoot)}:${c.start}-${c.end}`)
    .join(" <-> ");
}

function clusterViolation(cluster, repoRoot) {
  return {
    path: toRepoRelative(cluster[0].path, repoRoot),
    line: cluster[0].start,
    col: 1,
    kind: `clone cluster (${cluster[0].nodeCount} nodes)`,
    detail: clusterLocs(cluster, repoRoot),
  };
}

async function collectFiles(repoRoot, files) {
  const violations = [];
  for (const path of files) {
    violations.push(
      ...(await tableViolationsForFile(resolve(repoRoot, path))).map((v) => ({
        ...v,
        path,
      })),
    );
  }
  return violations;
}

function usage() {
  process.stderr.write(
    "Usage:\n  node scripts/hooks/lint-dup-structural.mjs --push\n  node scripts/hooks/lint-dup-structural.mjs --staged\n  node scripts/hooks/lint-dup-structural.mjs --all\n  node scripts/hooks/lint-dup-structural.mjs --files <path> [...]\n",
  );
}

export function main(argv) {
  return runRatchetHook(argv, {
    tool: "lint-dup-structural",
    ratchetGate,
    runAll: runAllMode,
    fileFilter: isStructuralFile,
    collectFiles,
    usage,
  });
}

/* v8 ignore next 6 */
if (isInvokedAsScript(import.meta.url)) {
  main(process.argv).catch((err) => {
    process.stderr.write(`lint-dup-structural: ${err.message ?? err}\n`);
    process.exit(2);
  });
}
