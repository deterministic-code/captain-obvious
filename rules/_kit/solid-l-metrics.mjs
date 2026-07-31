#!/usr/bin/env node
import { extname } from "node:path";
import ts from "typescript";
import { isExcluded, readSourceOrNull, runFileHook } from "./lint-shared.mjs";
import { parseSourceFile } from "./fn-metrics.mjs";
import { classifyMethod } from "./solid-i-metrics.mjs";
import { JS_TS_EXTS } from "@deterministic-code/captain-obvious/languages";
const TEST_FILE_RE = /\.(test|spec)\.[cm]?[jt]sx?$|\/__tests__\//;
const ALLOW_MARKER = "solid-l-allow";

/**
 * Built-in constructors whose `instanceof` is an idiomatic runtime type-guard,
 * not a substitutability smell. Any `*Error` name is treated the same way — a
 * catch handler discriminating error subclasses is normal, not an LSP break.
 */
const BUILTIN_CTORS = new Set([
  "Object",
  "Array",
  "Function",
  "Boolean",
  "Number",
  "String",
  "Symbol",
  "BigInt",
  "Date",
  "RegExp",
  "Promise",
  "Map",
  "Set",
  "WeakMap",
  "WeakSet",
  "ArrayBuffer",
  "SharedArrayBuffer",
  "DataView",
  "Uint8Array",
  "Uint8ClampedArray",
  "Int8Array",
  "Int16Array",
  "Uint16Array",
  "Int32Array",
  "Uint32Array",
  "Float32Array",
  "Float64Array",
  "BigInt64Array",
  "BigUint64Array",
  "Buffer",
  "URL",
  "URLSearchParams",
  "TextEncoder",
  "TextDecoder",
]);

export function isAnalyzable(path) {
  if (isExcluded(path)) return false;
  if (TEST_FILE_RE.test(path)) return false;
  return JS_TS_EXTS.has(extname(path));
}

function isDomainCtor(name) {
  if (BUILTIN_CTORS.has(name) || /(Error|Exception)$/.test(name)) return false;
  return /^[A-Z]/.test(name);
}

function locOf(sf, node) {
  const at = sf.getLineAndCharacterOfPosition(node.getStart(sf));
  return { line: at.line + 1, col: at.character + 1 };
}

function instanceofViolation(sf, path, node) {
  if (node.operatorToken.kind !== ts.SyntaxKind.InstanceOfKeyword) return null;
  if (!ts.isIdentifier(node.right) || !isDomainCtor(node.right.text))
    return null;
  return {
    path,
    ...locOf(sf, node),
    kind: "lsp",
    detail: `branches on \`instanceof ${node.right.text}\` — inspecting a concrete subtype instead of relying on the base contract defeats substitutability; add a polymorphic method to the base type`,
  };
}

function baseClassName(node) {
  for (const clause of node.heritageClauses ?? []) {
    if (clause.token !== ts.SyntaxKind.ExtendsKeyword) continue;
    const base = clause.types[0]?.expression;
    if (base && ts.isIdentifier(base)) return base.text;
  }
  return null;
}

function overrideRefusals(sf, path, node) {
  const base = baseClassName(node);
  if (!base || /(Error|Exception)$/.test(base) || BUILTIN_CTORS.has(base)) {
    return [];
  }
  const out = [];
  for (const member of node.members) {
    if (classifyMethod(member) !== "refusal") continue;
    out.push({
      path,
      ...locOf(sf, member),
      kind: "lsp",
      detail: `overrides a method of base "${base}" with a refusal (throws not-implemented/supported) — a subtype must honor its base's contract to remain substitutable`,
    });
  }
  return out;
}

export function analyzeLsp(path, src) {
  if (src.includes(ALLOW_MARKER)) return [];
  const sf = parseSourceFile(path, src);
  const out = [];
  const visit = (node) => {
    if (ts.isBinaryExpression(node)) {
      const v = instanceofViolation(sf, path, node);
      if (v) out.push(v);
    }
    if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) {
      out.push(...overrideRefusals(sf, path, node));
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

async function fileLspViolations(path) {
  const src = await readSourceOrNull(path);
  return src === null ? [] : analyzeLsp(path, src);
}

function usage() {
  process.stderr.write(
    `Usage (JS/TS only):\n` +
      `  node scripts/hooks/lint-solid-l.mjs --staged   (diff-scoped: only files you added/modified)\n` +
      `  node scripts/hooks/lint-solid-l.mjs --all       (audit every subtype / instanceof)\n` +
      `  node scripts/hooks/lint-solid-l.mjs --files <path> [...]\n`,
  );
}

export async function runSolidLHook(argv) {
  await runFileHook(argv, {
    usage,
    collect: (path) => (isAnalyzable(path) ? fileLspViolations(path) : []),
    okLine: "SOLID-L: no Liskov-substitution violations",
    summary: (n) =>
      `SOLID-L: ${n} violation(s). A subtype must be substitutable for its base — don't branch on a concrete subtype (\`instanceof\`) or override a base method with a refusal (error-subclass guards are exempt).`,
  });
}
