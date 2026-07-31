import { isAbsolute, relative } from "node:path";
import { cloneClusters } from "./dup-structural-metrics.mjs";

export const FN_MIN_NODES = 14;

const FUNCTION_KINDS = new Set([
  "FunctionDeclaration",
  "FunctionExpression",
  "ArrowFunction",
  "MethodDeclaration",
]);

function normalized(path) {
  return `/${String(path).replace(/^\.?\/+/, "")}`;
}

function isCanonical(path) {
  return normalized(path).includes("/emitter-sdk/");
}

function toRepoRelative(path, repoRoot) {
  return isAbsolute(path) ? relative(repoRoot, path) : path;
}

/**
 * Function-body clone clusters: sets of ≥2 *named* function-like nodes sharing
 * an α-normalized body fingerprint. Object-literal clusters are dropped (that's
 * `lint-dup-structural`'s sibling-table concern), and so are anonymous inline
 * callbacks — a reinvented helper has a name; a repeated `it(...)` arrow does
 * not. A cluster is only actionable if it spans ≥2 files or ≥2 distinct names.
 */
export function functionClones(
  subtreesByFile,
  { minNodes = FN_MIN_NODES } = {},
) {
  return cloneClusters(subtreesByFile, { minNodes })
    .filter((cluster) => cluster.every((m) => FUNCTION_KINDS.has(m.kind)))
    .filter((cluster) => {
      const named = cluster.filter((m) => m.name);
      if (named.length < 2) return false;
      const files = new Set(named.map((m) => m.path)).size;
      const names = new Set(named.map((m) => m.name)).size;
      return files > 1 || names > 1;
    });
}

/** `"canonical"` when the cluster straddles the `emitter-sdk/` boundary (import the SDK one), else `"cross-file"` or `"same-file"`. */
export function clusterTier(cluster) {
  const inSdk = cluster.some((m) => isCanonical(m.path));
  const outSdk = cluster.some((m) => !isCanonical(m.path));
  if (inSdk && outSdk) return "canonical";
  return new Set(cluster.map((m) => m.path)).size > 1
    ? "cross-file"
    : "same-file";
}

const TIER_ADVICE = {
  canonical:
    "one copy lives in emitter-sdk — import it instead of reimplementing.",
  "cross-file": "same body reinvented across files — extract a shared helper.",
  "same-file": "same body under different names — collapse to one.",
};

/** One violation per cluster, anchored at `primary` (the diff member in ratchet mode, else the first non-canonical site). */
export function clusterViolation(cluster, repoRoot, primary) {
  const anchor =
    primary ?? cluster.find((m) => !isCanonical(m.path)) ?? cluster[0];
  const tier = clusterTier(cluster);
  const sites = cluster
    .map(
      (m) =>
        `${toRepoRelative(m.path, repoRoot)}:${m.start} ${m.name ?? "(anon)"}`,
    )
    .join(" ↔ ");
  return {
    path: toRepoRelative(anchor.path, repoRoot),
    line: anchor.start,
    col: 1,
    kind: `duplicate function body (${cluster.length} sites, ${anchor.nodeCount} nodes, ${tier})`,
    detail: `identical α-normalized body: ${sites}. ${TIER_ADVICE[tier]}`,
  };
}
