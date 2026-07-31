#!/usr/bin/env node
import { extname } from "node:path";
import ts from "typescript";
import { isExcluded, readSourceOrNull, runFileHook } from "./lint-shared.mjs";
import { parseSourceFile } from "./fn-metrics.mjs";
import { JS_TS_EXTS } from "@deterministic-code/captain-obvious/languages";
const TEST_FILE_RE = /\.(test|spec)\.[cm]?[jt]sx?$|\/__tests__\//;
const ALLOW_MARKER = "solid-o-allow";
const MIN_ARMS = 3;

/**
 * Discriminants that name a closed, compiler-enforced variant set — a SQL
 * dialect, an id representation, a fixed field/kind union. An exhaustive switch
 * over these is OCP-correct (a new variant breaks the build until every arm is
 * updated), not the open-ended dispatch OCP warns about.
 */
const EXHAUSTIVE_DISCRIMINANTS = new Set([
  "dialect",
  "idType",
  "uuidRepr",
  "kind",
  "type",
  "backend",
  "provider",
  "key",
  "mode",
]);

export function isAnalyzable(path) {
  if (isExcluded(path)) return false;
  if (TEST_FILE_RE.test(path)) return false;
  return JS_TS_EXTS.has(extname(path));
}

function trailingName(text) {
  // Unreachable: String.split always returns >=1 element, so pop() is never undefined.
  /* v8 ignore next */
  const seg = text.split(".").pop() ?? text;
  const m = /^[A-Za-z_$][\w$]*/.exec(seg);
  return m ? m[0] : null;
}

function isExhaustive(discriminantText) {
  const name = trailingName(discriminantText);
  return name !== null && EXHAUSTIVE_DISCRIMINANTS.has(name);
}

function stringCaseCount(switchNode) {
  let n = 0;
  for (const clause of switchNode.caseBlock.clauses) {
    if (ts.isCaseClause(clause) && ts.isStringLiteralLike(clause.expression))
      n++;
  }
  return n;
}

function eqStringOperand(cond) {
  if (!ts.isBinaryExpression(cond)) return null;
  const op = cond.operatorToken.kind;
  if (
    op !== ts.SyntaxKind.EqualsEqualsEqualsToken &&
    op !== ts.SyntaxKind.EqualsEqualsToken
  ) {
    return null;
  }
  if (ts.isStringLiteralLike(cond.right)) return cond.left.getText();
  if (ts.isStringLiteralLike(cond.left)) return cond.right.getText();
  return null;
}

function ifChain(head) {
  const operands = [];
  let cur = head;
  while (cur && ts.isIfStatement(cur)) {
    const operand = eqStringOperand(cur.expression);
    if (operand === null) return null;
    operands.push(operand);
    cur = cur.elseStatement;
    if (cur && !ts.isIfStatement(cur)) break;
  }
  if (!operands.every((o) => o === operands[0])) return null;
  return { operand: operands[0], arms: operands.length };
}

function isChainContinuation(node) {
  return (
    node.parent &&
    ts.isIfStatement(node.parent) &&
    node.parent.elseStatement === node
  );
}

function locOf(sf, node) {
  const at = sf.getLineAndCharacterOfPosition(node.getStart(sf));
  return { line: at.line + 1, col: at.character + 1 };
}

function switchViolation(sf, path, node) {
  if (isExhaustive(node.expression.getText())) return null;
  const arms = stringCaseCount(node);
  if (arms < MIN_ARMS) return null;
  return {
    path,
    ...locOf(sf, node),
    kind: "ocp",
    detail: `switch on "${node.expression.getText()}" dispatches on ${arms} string variants — adding a variant edits this switch; replace with a polymorphic/strategy table keyed by the variant`,
  };
}

function ifChainViolation(sf, path, node) {
  if (isChainContinuation(node)) return null;
  const chain = ifChain(node);
  if (!chain || chain.arms < MIN_ARMS || isExhaustive(chain.operand))
    return null;
  return {
    path,
    ...locOf(sf, node),
    kind: "ocp",
    detail: `if/else-if chain on "${chain.operand}" dispatches on ${chain.arms} string variants — adding a variant edits this chain; replace with a polymorphic/strategy table keyed by the variant`,
  };
}

export function analyzeOcp(path, src) {
  if (src.includes(ALLOW_MARKER)) return [];
  const sf = parseSourceFile(path, src);
  const out = [];
  const visit = (node) => {
    if (ts.isSwitchStatement(node)) {
      const v = switchViolation(sf, path, node);
      if (v) out.push(v);
    }
    if (ts.isIfStatement(node)) {
      const v = ifChainViolation(sf, path, node);
      if (v) out.push(v);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

async function fileOcpViolations(path) {
  const src = await readSourceOrNull(path);
  return src === null ? [] : analyzeOcp(path, src);
}

function usage() {
  process.stderr.write(
    `Usage (JS/TS only):\n` +
      `  node scripts/hooks/lint-solid-o.mjs --staged   (diff-scoped: only files you added/modified)\n` +
      `  node scripts/hooks/lint-solid-o.mjs --all       (audit every dispatch)\n` +
      `  node scripts/hooks/lint-solid-o.mjs --files <path> [...]\n`,
  );
}

export async function runSolidOHook(argv) {
  await runFileHook(argv, {
    usage,
    collect: (path) => (isAnalyzable(path) ? fileOcpViolations(path) : []),
    okLine: "SOLID-O: no open/closed violations",
    summary: (n) =>
      `SOLID-O: ${n} violation(s). Dispatching on a string variant with a switch/if-chain forces a modification for every new variant — make it open for extension with a polymorphic table (closed discriminants like dialect/kind are exempt).`,
  });
}
