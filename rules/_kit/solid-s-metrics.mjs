#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import ts from "typescript";
import { isExcluded, runFileHook } from "./lint-shared.mjs";
import { parseSourceFile, stagedAddedLines } from "./fn-metrics.mjs";
import { JS_TS_EXTS } from "@deterministic-code/captain-obvious/languages";

export const CLASS_LIMITS = {
  lcom4: 1,
  deps: 8,
};

const TEST_FILE_RE = /\.(test|spec)\.[cm]?[jt]sx?$|\/__tests__\//;
const ALLOW_MARKER = "solid-s-allow";
const METHOD_FLOOR = 2;

export function isAnalyzable(path) {
  if (isExcluded(path)) return false;
  if (TEST_FILE_RE.test(path)) return false;
  return JS_TS_EXTS.has(extname(path));
}

function importedBindings(sf) {
  const names = new Set();
  const addName = (node) => {
    if (node && ts.isIdentifier(node)) names.add(node.text);
  };
  for (const stmt of sf.statements) {
    if (!ts.isImportDeclaration(stmt) || !stmt.importClause) continue;
    const { name, namedBindings } = stmt.importClause;
    addName(name);
    if (namedBindings && ts.isNamespaceImport(namedBindings)) {
      addName(namedBindings.name);
    }
    if (namedBindings && ts.isNamedImports(namedBindings)) {
      for (const el of namedBindings.elements) addName(el.name);
    }
  }
  return names;
}

function typeDep(typeNode, importedNames) {
  if (!typeNode || !ts.isTypeReferenceNode(typeNode)) return undefined;
  const head = ts.isQualifiedName(typeNode.typeName)
    ? typeNode.typeName.left
    : typeNode.typeName;
  if (ts.isIdentifier(head) && importedNames.has(head.text)) return head.text;
  return undefined;
}

function classMembers(node, importedNames) {
  const fields = new Set();
  const fieldDep = new Map();
  const methods = [];
  const recordField = (name, type) => {
    fields.add(name);
    const dep = typeDep(type, importedNames);
    if (dep) fieldDep.set(name, dep);
  };
  for (const m of node.members) {
    if (ts.isPropertyDeclaration(m) && m.name && ts.isIdentifier(m.name)) {
      recordField(m.name.text, m.type);
    }
    if (ts.isConstructorDeclaration(m)) {
      for (const p of m.parameters) {
        const isProperty = (p.modifiers ?? []).length > 0;
        if (isProperty && ts.isIdentifier(p.name))
          recordField(p.name.text, p.type);
      }
      methods.push({ node: m, name: "constructor", isCtor: true });
      continue;
    }
    if (
      (ts.isMethodDeclaration(m) ||
        ts.isGetAccessor(m) ||
        ts.isSetAccessor(m)) &&
      m.name &&
      ts.isIdentifier(m.name)
    ) {
      methods.push({ node: m, name: m.name.text, isCtor: false });
    }
  }
  return { fields, fieldDep, methods };
}

function thisAccess(node) {
  return (
    ts.isPropertyAccessExpression(node) &&
    node.expression.kind === ts.SyntaxKind.ThisKeyword &&
    ts.isIdentifier(node.name)
  );
}

function methodTouchpoints(method, ctx) {
  const { fields, fieldDep, methodNames, importedNames } = ctx;
  const usedFields = new Set();
  const calledMethods = new Set();
  const usedDeps = new Set();
  const walk = (n) => {
    if (thisAccess(n)) {
      const key = n.name.text;
      if (fields.has(key)) usedFields.add(key);
      if (methodNames.has(key)) calledMethods.add(key);
      if (fieldDep.has(key)) usedDeps.add(fieldDep.get(key));
    }
    if (ts.isIdentifier(n) && importedNames.has(n.text)) usedDeps.add(n.text);
    ts.forEachChild(n, walk);
  };
  walk(method.node);
  return { usedFields, calledMethods, usedDeps };
}

function makeUnionFind(keys) {
  const parent = new Map(keys.map((k) => [k, k]));
  const find = (x) => {
    let root = x;
    while (parent.get(root) !== root) root = parent.get(root);
    while (parent.get(x) !== root) {
      const nxt = parent.get(x);
      parent.set(x, root);
      x = nxt;
    }
    return root;
  };
  const union = (a, b) => parent.set(find(a), find(b));
  return { find, union };
}

function unionBySharedKey(behavioral, keysOf, union) {
  const owner = new Map();
  for (const m of behavioral) {
    for (const key of keysOf(m)) {
      if (owner.has(key)) union(owner.get(key), m.name);
      else owner.set(key, m.name);
    }
  }
}

function cohesionGraph(behavioral, fields) {
  const names = new Set(behavioral.map((m) => m.name));
  const { find, union } = makeUnionFind([...names]);
  unionBySharedKey(behavioral, (m) => m.touch.usedFields, union);
  unionBySharedKey(behavioral, (m) => m.touch.usedDeps, union);
  for (const m of behavioral) {
    for (const callee of m.touch.calledMethods) {
      if (names.has(callee)) union(m.name, callee);
    }
  }
  const components = new Map();
  for (const m of behavioral) {
    const root = find(m.name);
    if (!components.has(root)) components.set(root, new Set());
    for (const d of m.touch.usedDeps) components.get(root).add(d);
  }
  return {
    lcom4: components.size,
    components: [...components.values()],
    fields,
  };
}

function disjointClusterDeps(components) {
  const nonEmpty = components.filter((c) => c.size > 0);
  for (let i = 0; i < nonEmpty.length; i++) {
    for (let j = i + 1; j < nonEmpty.length; j++) {
      const a = nonEmpty[i];
      const b = nonEmpty[j];
      // Dead false-path: cohesionGraph components are connected, so two non-empty clusters never share a dep; the first pair always returns.
      /* v8 ignore else */
      if (![...a].some((d) => b.has(d))) {
        return { split: true, left: [...a].sort(), right: [...b].sort() };
      }
      // Dead loop-back: the first disjoint pair always returns, so neither loop ever iterates a second time.
      /* v8 ignore next 2 */
    }
  }
  return { split: false };
}

function hasAllowMarker(src, node) {
  const ranges = ts.getLeadingCommentRanges(src, node.getFullStart()) ?? [];
  return ranges.some((r) => src.slice(r.pos, r.end).includes(ALLOW_MARKER));
}

function className(node) {
  return node.name && ts.isIdentifier(node.name)
    ? `"${node.name.text}"`
    : "(anonymous class)";
}

export function analyzeSource(path, src) {
  const sf = parseSourceFile(path, src);
  const importedNames = importedBindings(sf);
  const classes = [];
  const visit = (node) => {
    if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) {
      classes.push(describeClass(node, { sf, src, importedNames }));
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return classes.filter(Boolean);
}

function describeClass(node, { sf, src, importedNames }) {
  const { fields, fieldDep, methods } = classMembers(node, importedNames);
  const methodNames = new Set(methods.map((m) => m.name));
  const ctx = { fields, fieldDep, methodNames, importedNames };
  const withTouch = methods.map((m) => ({
    ...m,
    touch: methodTouchpoints(m, ctx),
  }));
  const behavioral = withTouch.filter((m) => !m.isCtor);
  // Only a fully inert method — no field, no sibling call, no external collaborator — carries zero cohesion signal (an interface no-op or throw-stub); counting it as its own LCOM4 component is a false positive. A method that uses a collaborator is a real responsibility even without shared `this` state, so it stays in the graph and connects to siblings sharing that collaborator.
  const stateful = behavioral.filter(
    (m) =>
      m.touch.usedFields.size > 0 ||
      m.touch.calledMethods.size > 0 ||
      m.touch.usedDeps.size > 0,
  );
  const allDeps = new Set(fieldDep.values());
  for (const m of withTouch) for (const d of m.touch.usedDeps) allDeps.add(d);
  const start = sf.getLineAndCharacterOfPosition(node.getStart(sf));
  const endLine = sf.getLineAndCharacterOfPosition(node.getEnd()).line;
  const graph = cohesionGraph(stateful, fields);
  return {
    name: className(node),
    startLine: start.line + 1,
    endLine: endLine + 1,
    col: start.character + 1,
    methodCount: stateful.length,
    lcom4: stateful.length < METHOD_FLOOR ? 1 : graph.lcom4,
    deps: allDeps.size,
    disjoint: disjointClusterDeps(graph.components),
    allow: hasAllowMarker(src, node),
  };
}

export function classesInDiff(classes, addedLines) {
  return classes.filter((c) => {
    for (let ln = c.startLine; ln <= c.endLine; ln++) {
      if (addedLines.has(ln)) return true;
    }
    return false;
  });
}

function classViolations(path, cls) {
  if (cls.allow || cls.methodCount < METHOD_FLOOR) return [];
  const out = [];
  const base = { path, line: cls.startLine, col: cls.col };
  if (cls.lcom4 > CLASS_LIMITS.lcom4) {
    const d = cls.disjoint;
    const suffix = d.split
      ? ` — one cluster owns {${d.left.join(", ")}}, another owns {${d.right.join(", ")}}; split them`
      : " — its methods form independent groups sharing no state; split the class";
    out.push({
      ...base,
      kind: "cohesion",
      detail: `class ${cls.name} has LCOM4 ${cls.lcom4} (limit ${CLASS_LIMITS.lcom4})${suffix}`,
    });
  }
  if (cls.deps > CLASS_LIMITS.deps) {
    out.push({
      ...base,
      kind: "fan-out",
      detail: `class ${cls.name} depends on ${cls.deps} imported collaborators (limit ${CLASS_LIMITS.deps}) — extract a collaborator or split the class`,
    });
  }
  return out;
}

async function fileViolations(path, staged) {
  let src;
  try {
    src = await readFile(path, "utf8");
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
  let classes = analyzeSource(path, src);
  if (staged) classes = classesInDiff(classes, await stagedAddedLines(path));
  return classes.flatMap((cls) => classViolations(path, cls));
}

function usage() {
  process.stderr.write(
    `Usage (JS/TS only):\n` +
      `  node scripts/hooks/lint-solid-s.mjs --staged   (diff-scoped: only classes you added/modified)\n` +
      `  node scripts/hooks/lint-solid-s.mjs --all       (audit every class)\n` +
      `  node scripts/hooks/lint-solid-s.mjs --files <path> [...]\n`,
  );
}

export async function runSolidSHook(argv) {
  await runFileHook(argv, {
    usage,
    collect: (path, mode) =>
      isAnalyzable(path) ? fileViolations(path, mode === "--staged") : [],
    okLine: "SOLID-S: no SRP violations",
    summary: (n) =>
      `SOLID-S: ${n} violation(s). A class should own one responsibility — LCOM4 measures whether its methods actually share state; fan-out measures how many subsystems it coordinates.`,
  });
}
