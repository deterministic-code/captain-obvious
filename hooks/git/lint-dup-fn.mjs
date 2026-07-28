#!/usr/bin/env node
import { relative, resolve } from "node:path";
import {
  collectAddedRanges,
  rangesOverlap,
  reportRatchetViolations,
  runRatchetHook,
} from "./dup-ratchet.mjs";
import { subtreesForFile } from "./dup-structural-metrics.mjs";
import { isStructuralFile } from "./lint-dup-structural.mjs";
import {
  FN_MIN_NODES,
  clusterViolation,
  functionClones,
} from "./dup-fn-metrics.mjs";
import {
  emitJson,
  formatViolation,
  isInvokedAsScript,
  jsonMode,
  listAllFiles,
} from "./lint-shared.mjs";

/** Test files legitimately repeat setup/callback shapes, and scaffold templates emit near-identical helpers per lane — neither is a reinvented production helper. */
function isCloneCandidate(path) {
  if (!isStructuralFile(path)) return false;
  const normalized = `/${path.replace(/^\.?\/+/, "")}`;
  if (/\.(test|spec)\./.test(normalized)) return false;
  if (normalized.includes("/__tests__/")) return false;
  if (normalized.includes("/templates/")) return false;
  return true;
}

async function allSubtrees(repoRoot) {
  const files = (await listAllFiles(repoRoot)).filter(isCloneCandidate);
  const out = [];
  for (const path of files) {
    out.push(
      await subtreesForFile(resolve(repoRoot, path), { minNodes: FN_MIN_NODES }),
    );
  }
  return out;
}

async function ratchetGate({ repoRoot, changedFiles, diffArgs, label, warn }) {
  const targets = changedFiles.filter(isCloneCandidate);
  if (targets.length === 0) {
    process.stdout.write(`lint-dup-fn: no ${label} code files.\n`);
    return;
  }
  const addedRanges = await collectAddedRanges(repoRoot, targets, diffArgs);
  const clusters = functionClones(await allSubtrees(repoRoot));
  const violations = [];
  for (const cluster of clusters) {
    const hit = cluster.find((m) => {
      const added = addedRanges.get(relative(repoRoot, m.path));
      return added && rangesOverlap([m.start, m.end], added);
    });
    if (hit) violations.push(clusterViolation(cluster, repoRoot, hit));
  }
  const n = violations.length;
  reportRatchetViolations(violations, {
    okLine: `lint-dup-fn: no newly-introduced duplicate function bodies in ${label}.`,
    summaryLine: `\nlint-dup-fn: ${n} newly-introduced duplicate function body/bodies. Extract a shared helper (or import the SDK one) in this same change.`,
    warnLine: warn
      ? `\n⚠ lint-dup-fn: ${n} newly-introduced duplicate function body/bodies — extract a shared helper (advisory — not blocking this push yet).`
      : undefined,
  });
}

async function runAllMode(repoRoot) {
  const clusters = functionClones(await allSubtrees(repoRoot));
  const violations = clusters.map((c) => clusterViolation(c, repoRoot));
  violations.sort((a, b) => a.kind.localeCompare(b.kind) || a.path.localeCompare(b.path));
  if (jsonMode()) return emitJson(violations);
  for (const v of violations) process.stdout.write(`${formatViolation(v)}\n`);
  process.stdout.write(
    `\nlint-dup-fn: ${clusters.length} duplicate-function-body cluster(s) (report-only; --push is the ratchet gate).\n`,
  );
}

async function collectFiles(repoRoot, files) {
  const given = new Set(files);
  return functionClones(await allSubtrees(repoRoot))
    .filter((c) => c.some((m) => given.has(relative(repoRoot, m.path))))
    .map((c) => clusterViolation(c, repoRoot));
}

function usage() {
  process.stderr.write(
    "Usage:\n  node scripts/hooks/lint-dup-fn.mjs --push\n  node scripts/hooks/lint-dup-fn.mjs --staged\n  node scripts/hooks/lint-dup-fn.mjs --all\n  node scripts/hooks/lint-dup-fn.mjs --files <path> [...]\n",
  );
}

export function main(argv) {
  return runRatchetHook(argv, {
    tool: "lint-dup-fn",
    ratchetGate,
    runAll: runAllMode,
    fileFilter: isCloneCandidate,
    collectFiles,
    usage,
  });
}

/* v8 ignore next 6 */
if (isInvokedAsScript(import.meta.url)) {
  main(process.argv).catch((err) => {
    process.stderr.write(`lint-dup-fn: ${err.message ?? err}\n`);
    process.exit(2);
  });
}
