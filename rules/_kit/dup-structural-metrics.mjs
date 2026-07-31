import { readFile } from "node:fs/promises";
import ts from "typescript";
import { parseSourceFile } from "./fn-metrics.mjs";
import {
  collectSubtrees,
  fingerprint,
  objectShape,
} from "./ast-fingerprint.mjs";

const MIN_SIBLINGS = 3;
const MIN_CLONE_NODES = 20;

const DRY_REF = 'See CLAUDE.md "DRY — extract on the second copy".';

function largestKeysetGroup(entries) {
  const byKeyset = new Map();
  for (const entry of entries) {
    const sig = entry.shape.keys.join("|");
    const group = byKeyset.get(sig);
    if (group) group.push(entry);
    else byKeyset.set(sig, [entry]);
  }
  let best = [];
  for (const group of byKeyset.values()) {
    if (group.length > best.length) best = group;
  }
  return best;
}

function classifyKeys(group) {
  const mechanical = [];
  const loadBearing = [];
  for (const key of group[0].shape.keys) {
    const fps = new Set(
      group.map(
        (entry) => entry.shape.props.find((p) => p.key === key).valueFp,
      ),
    );
    (fps.size === 1 ? mechanical : loadBearing).push(key);
  }
  return { mechanical, loadBearing };
}

/**
 * The blocking smell is repeated *logic*, not repeated *data*: a `{ a: 1 }`
 * lookup table is legitimately per-row data, but a mechanical column whose value
 * is a regex or function — identical across every sibling modulo the literals
 * baked inside it — is copy-pasted code that wants a factory. This is what
 * separates `TYPE_FILE_CONVENTIONS` (collapse) from a plain data map (leave).
 */
function isCollapsibleFp(fp) {
  return /Regex|ArrowFunction|FunctionExpression/.test(fp);
}

function analyzeTable(objectNode) {
  const entries = [];
  for (const prop of objectNode.properties) {
    if (!ts.isPropertyAssignment(prop)) continue;
    if (!ts.isObjectLiteralExpression(prop.initializer)) continue;
    const shape = objectShape(prop.initializer);
    if (shape) entries.push({ shape });
  }
  if (entries.length < MIN_SIBLINGS) return null;
  const group = largestKeysetGroup(entries);
  if (group.length < MIN_SIBLINGS) return null;
  const { mechanical, loadBearing } = classifyKeys(group);
  const collapsible = mechanical.filter((key) =>
    isCollapsibleFp(group[0].shape.props.find((p) => p.key === key).valueFp),
  );
  if (collapsible.length === 0) return null;
  return { count: group.length, mechanical: collapsible, loadBearing };
}

export function tableViolations(path, sf) {
  const out = [];
  const visit = (node) => {
    if (ts.isObjectLiteralExpression(node)) {
      const table = analyzeTable(node);
      if (table) {
        const start = sf.getLineAndCharacterOfPosition(node.getStart(sf));
        const collapse = table.mechanical.join(", ");
        const keep = table.loadBearing.length
          ? ` Load-bearing (keep as-is): ${table.loadBearing.join(", ")}.`
          : "";
        out.push({
          path,
          line: start.line + 1,
          col: start.character + 1,
          kind: `structural sibling duplication (${table.count} entries)`,
          detail: `${table.count} sibling values share one key-set. Mechanical columns identical modulo literals — collapse to a data table + factory: ${collapse}.${keep} ${DRY_REF}`,
        });
      }
    }
    node.forEachChild(visit);
  };
  visit(sf);
  return out;
}

export function cloneClusters(subtreesByFile, { minNodes = MIN_CLONE_NODES }) {
  const byFp = new Map();
  for (const { path, subtrees } of subtreesByFile) {
    for (const st of subtrees) {
      if (st.nodeCount < minNodes) continue;
      const at = {
        path,
        name: st.name ?? null,
        kind: st.kind,
        fp: st.fp,
        start: st.start,
        end: st.end,
        nodeCount: st.nodeCount,
      };
      const group = byFp.get(st.fp);
      if (group) group.push(at);
      else byFp.set(st.fp, [at]);
    }
  }
  const clusters = [];
  for (const group of byFp.values()) {
    if (group.length >= 2) clusters.push(group);
  }
  return clusters;
}

async function readOrNull(path) {
  return readFile(path, "utf8").then(
    (src) => src,
    (err) => {
      if (err.code === "ENOENT" || err.code === "EISDIR") return null;
      throw err;
    },
  );
}

export async function tableViolationsForFile(path) {
  const src = await readOrNull(path);
  if (src === null) return [];
  return tableViolations(path, parseSourceFile(path, src));
}

export async function subtreesForFile(
  path,
  { minNodes = MIN_CLONE_NODES } = {},
) {
  const src = await readOrNull(path);
  if (src === null) return { path, subtrees: [] };
  return {
    path,
    subtrees: collectSubtrees(parseSourceFile(path, src), { minNodes }),
  };
}
