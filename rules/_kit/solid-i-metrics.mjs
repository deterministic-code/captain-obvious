#!/usr/bin/env node
import ts from "typescript";
import { isExcluded, readSourceOrNull, runFileHook } from "./lint-shared.mjs";
import { parseSourceFile } from "./fn-metrics.mjs";

const TEST_FILE_RE = /\.(test|spec)\.[cm]?[jt]sx?$|\/__tests__\//;
const ALLOW_MARKER = "solid-i-allow";
const STUB_LIMIT = 1;
const REFUSAL_NAME_RE = /NotImplemented|NotSupported/;
const REFUSAL_MSG_RE = /not\s+(implement|support|avail)\w*/i;

function isAllowlisted(path) {
  return isExcluded(path) || TEST_FILE_RE.test(path);
}

export function implementsClause(node) {
  const names = [];
  for (const h of node.heritageClauses ?? []) {
    if (h.token !== ts.SyntaxKind.ImplementsKeyword) continue;
    for (const t of h.types) {
      if (ts.isIdentifier(t.expression)) names.push(t.expression.text);
    }
  }
  return names;
}

function throwIsRefusal(stmt) {
  const expr = stmt.expression;
  if (!expr || !ts.isNewExpression(expr)) return false;
  if (
    ts.isIdentifier(expr.expression) &&
    REFUSAL_NAME_RE.test(expr.expression.text)
  ) {
    return true;
  }
  for (const arg of expr.arguments ?? []) {
    if (ts.isStringLiteralLike(arg) && REFUSAL_MSG_RE.test(arg.text))
      return true;
  }
  return false;
}

/**
 * A method fulfills its interface contract unless its body is empty or a bare
 * top-level `throw`. A single throw whose value names/messages a "not
 * implemented/supported" refusal is the unambiguous ISP tell; other empty or
 * throw-only bodies are hollow stubs. Plain `return` bodies are left alone —
 * an empty-return can be a valid minimal implementation.
 */
export function classifyMethod(member) {
  if (!ts.isMethodDeclaration(member) || !member.body) return "ok";
  const stmts = member.body.statements;
  if (stmts.length === 0) return "stub";
  if (stmts.length === 1 && ts.isThrowStatement(stmts[0])) {
    return throwIsRefusal(stmts[0]) ? "refusal" : "stub";
  }
  return "ok";
}

function methodName(member) {
  return ts.isIdentifier(member.name) || ts.isStringLiteralLike(member.name)
    ? member.name.text
    : "<computed>";
}

function classViolation(path, sf, node) {
  const mods = ts.getModifiers(node) ?? [];
  if (mods.some((m) => m.kind === ts.SyntaxKind.AbstractKeyword)) return null;
  const interfaces = implementsClause(node);
  if (interfaces.length === 0) return null;

  const refusals = [];
  const stubs = [];
  for (const member of node.members) {
    const verdict = classifyMethod(member);
    if (verdict === "refusal") refusals.push(methodName(member));
    else if (verdict === "stub") stubs.push(methodName(member));
  }
  if (refusals.length === 0 && stubs.length <= STUB_LIMIT) return null;

  const at = sf.getLineAndCharacterOfPosition(node.name.getStart(sf));
  const offenders = [...refusals, ...stubs];
  const verb = refusals.length > 0 ? "refuses" : "leaves hollow";
  return {
    path,
    line: at.line + 1,
    col: at.character + 1,
    kind: "isp",
    detail: `class "${node.name.text}" implements ${interfaces.join(", ")} but ${verb} ${offenders.join(
      ", ",
    )} — segregate the interface so implementers aren't forced to stub methods they can't honor`,
  };
}

export function analyzeIsp(path, src) {
  if (isAllowlisted(path) || src.includes(ALLOW_MARKER)) return [];
  const sf = parseSourceFile(path, src);
  const out = [];
  for (const s of sf.statements) {
    if (!ts.isClassDeclaration(s) || !s.name) continue;
    const v = classViolation(path, sf, s);
    if (v) out.push(v);
  }
  return out;
}

export async function fileIspViolations(path) {
  const src = await readSourceOrNull(path);
  return src === null ? [] : analyzeIsp(path, src);
}

function usage() {
  process.stderr.write(
    `Usage (TS classes that implement an interface):\n` +
      `  node scripts/hooks/lint-solid-i.mjs --staged   (diff-scoped: only files you added/modified)\n` +
      `  node scripts/hooks/lint-solid-i.mjs --all       (audit every class)\n` +
      `  node scripts/hooks/lint-solid-i.mjs --files <path> [...]\n`,
  );
}

export async function runSolidIHook(argv) {
  await runFileHook(argv, {
    usage,
    collect: (path) => fileIspViolations(path),
    okLine: "SOLID-I: no interface-segregation violations",
    summary: (n) =>
      `SOLID-I: ${n} violation(s). A class must not implement an interface it can only satisfy by stubbing or refusing methods — split the interface so each implementer sees only what it fulfills.`,
  });
}
