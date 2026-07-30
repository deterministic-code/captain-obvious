#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { dirname, extname, resolve as resolvePath } from "node:path";
import ts from "typescript";
import { isExcluded, runFileHook } from "./lint-shared.mjs";
import { parseSourceFile } from "./fn-metrics.mjs";

const TEST_FILE_RE = /\.(test|spec)\.[cm]?[jt]sx?$|\/__tests__\//;
const ALLOW_MARKER = "solid-d-allow";
const CHECKED_LAYERS = new Set(["services", "routes"]);
const CONCRETION_LAYERS = new Set(["services", "repositories"]);
const RESOLVE_EXTS = [".ts", ".tsx", ".mts", ".cts", ".js", ".mjs", ".jsx"];

export function layerOf(path) {
  const p = `/${path.replace(/^\.?\/+/, "")}/`;
  if (p.includes("/app/")) return "app";
  if (p.includes("/routes/")) return "routes";
  if (p.includes("/services/")) return "services";
  if (p.includes("/repositories/")) return "repositories";
  if (p.includes("/middleware/")) return "middleware";
  return "other";
}

function isAllowlisted(path) {
  return isExcluded(path) || TEST_FILE_RE.test(path);
}

function extendsError(node) {
  for (const h of node.heritageClauses ?? []) {
    if (h.token !== ts.SyntaxKind.ExtendsKeyword) continue;
    for (const t of h.types) {
      if (ts.isIdentifier(t.expression) && /Error$/.test(t.expression.text)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * A DIP-relevant collaborator carries behavior (methods). A concrete class with
 * no methods is a value object / DTO / marker (SkipStep) or an exception —
 * constructing one is not a dependency-inversion concern.
 */
export function injectableConcretions(src, path = "x.ts") {
  const sf = parseSourceFile(path, src);
  const names = new Set();
  for (const s of sf.statements) {
    if (!ts.isClassDeclaration(s) || !s.name) continue;
    const mods = ts.getModifiers(s) ?? [];
    const exported = mods.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
    const abstract = mods.some((m) => m.kind === ts.SyntaxKind.AbstractKeyword);
    if (!exported || abstract || extendsError(s)) continue;
    const methods = s.members.filter((m) => ts.isMethodDeclaration(m)).length;
    if (methods > 0) names.add(s.name.text);
  }
  return names;
}

function relativeValueImports(sf) {
  const map = new Map();
  for (const s of sf.statements) {
    if (!ts.isImportDeclaration(s) || !s.importClause) continue;
    if (s.importClause.isTypeOnly) continue;
    const spec = s.moduleSpecifier;
    if (!ts.isStringLiteral(spec) || !spec.text.startsWith(".")) continue;
    if (s.importClause.name) map.set(s.importClause.name.text, spec.text);
    const nb = s.importClause.namedBindings;
    if (nb && ts.isNamedImports(nb)) {
      for (const el of nb.elements) {
        if (!el.isTypeOnly) map.set(el.name.text, spec.text);
      }
    }
  }
  return map;
}

export function constructions(sf) {
  const out = [];
  const visit = (n) => {
    if (ts.isNewExpression(n) && ts.isIdentifier(n.expression)) {
      const at = sf.getLineAndCharacterOfPosition(n.getStart(sf));
      out.push({
        name: n.expression.text,
        line: at.line + 1,
        col: at.character + 1,
      });
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

const srcCache = new Map();

async function readCached(path) {
  if (srcCache.has(path)) return srcCache.get(path);
  const src = await readFile(path, "utf8").then(
    (s) => s,
    (err) => {
      if (err.code === "ENOENT" || err.code === "EISDIR") return null;
      throw err;
    },
  );
  srcCache.set(path, src);
  return src;
}

async function resolveRelative(fromPath, spec) {
  const base = resolvePath(dirname(fromPath), spec);
  const candidates = extname(base)
    ? [base]
    : [
        ...RESOLVE_EXTS.map((e) => base + e),
        ...RESOLVE_EXTS.map((e) => resolvePath(base, `index${e}`)),
      ];
  for (const c of candidates) {
    const src = await readCached(c);
    if (src !== null) return { path: c, src };
  }
  return null;
}

async function constructionViolation(c, ctx) {
  const spec = ctx.imports.get(c.name);
  if (!spec) return null;
  if (!ctx.targets.has(spec))
    ctx.targets.set(spec, await ctx.resolve(ctx.path, spec));
  const target = ctx.targets.get(spec);
  if (!target || !CONCRETION_LAYERS.has(layerOf(target.path))) return null;
  if (!injectableConcretions(target.src, target.path).has(c.name)) return null;
  return {
    path: ctx.path,
    line: c.line,
    col: c.col,
    kind: "dip",
    detail: `${ctx.fromLayer} layer constructs concrete class "${c.name}" (from ${spec}) — inject it via an interface, or build it in a factory (buildRepoForBackend / resolveServices)`,
  };
}

export async function analyzeDip(path, src, resolve) {
  if (!CHECKED_LAYERS.has(layerOf(path)) || isAllowlisted(path)) return [];
  if (src.includes(ALLOW_MARKER)) return [];
  const sf = parseSourceFile(path, src);
  const ctx = {
    path,
    resolve,
    imports: relativeValueImports(sf),
    fromLayer: layerOf(path),
    targets: new Map(),
  };
  const out = [];
  for (const c of constructions(sf)) {
    const v = await constructionViolation(c, ctx);
    if (v) out.push(v);
  }
  return out;
}

export async function fileDipViolations(path, resolve = resolveRelative) {
  const src = await readCached(path);
  if (src === null) return [];
  return analyzeDip(path, src, resolve);
}

function usage() {
  process.stderr.write(
    `Usage (TS services/routes layers only):\n` +
      `  node scripts/hooks/lint-solid-d.mjs --staged   (diff-scoped: only files you added/modified)\n` +
      `  node scripts/hooks/lint-solid-d.mjs --all       (audit every service/route)\n` +
      `  node scripts/hooks/lint-solid-d.mjs --files <path> [...]\n`,
  );
}

export async function runSolidDHook(argv) {
  await runFileHook(argv, {
    usage,
    collect: (path) => fileDipViolations(path),
    okLine: "SOLID-D: no dependency-inversion violations",
    summary: (n) =>
      `SOLID-D: ${n} violation(s). A high-level layer must not construct a concrete collaborator — depend on its interface and inject it, or build it in a factory.`,
  });
}
