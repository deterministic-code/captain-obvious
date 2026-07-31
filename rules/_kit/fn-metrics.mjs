#!/usr/bin/env node
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { promisify } from "node:util";
import ts from "typescript";
import {
  emitJson,
  formatViolation,
  isExcluded,
  jsonMode,
  listAllFiles,
  listStagedFiles,
  sanitizedGitEnv,
  stripStringsAndComments,
} from "./lint-shared.mjs";
import { JS_TS_EXTS } from "@deterministic-code/captain-obvious/languages";

const execFileAsync = promisify(execFile);

export const FN_LIMITS = {
  lines: 60,
  statements: 20,
  complexity: 15,
  params: 3,
};

const TEST_FILE_RE = /\.(test|spec)\.[cm]?[jt]sx?$|\/__tests__\//;

const SPLIT_ADVICE = "split the function or extract a helper";

const METRIC_META = {
  lines: {
    script: "lint-max-lines",
    flag: "max-lines",
    noun: "lines",
    advice: SPLIT_ADVICE,
    configKey: "maxLines",
  },
  statements: {
    script: "lint-max-statements",
    flag: "max-statements",
    noun: "statements",
    advice: SPLIT_ADVICE,
    configKey: "maxStatements",
  },
  complexity: {
    script: "lint-complexity",
    flag: "complexity",
    noun: "cyclomatic complexity",
    advice: SPLIT_ADVICE,
    configKey: "maxComplexity",
  },
  params: {
    script: "lint-max-params",
    flag: "max-params",
    noun: "parameters",
    advice: "group related arguments into a single options object",
    configKey: "maxParams",
  },
};

const FN_KINDS = new Set([
  ts.SyntaxKind.FunctionDeclaration,
  ts.SyntaxKind.FunctionExpression,
  ts.SyntaxKind.ArrowFunction,
  ts.SyntaxKind.MethodDeclaration,
  ts.SyntaxKind.Constructor,
  ts.SyntaxKind.GetAccessor,
  ts.SyntaxKind.SetAccessor,
]);

export function isAnalyzable(path) {
  if (isExcluded(path)) return false;
  if (TEST_FILE_RE.test(path)) return false;
  return JS_TS_EXTS.has(extname(path));
}

function isFnLike(node) {
  return FN_KINDS.has(node.kind);
}

function functionName(node) {
  if (node.name && ts.isIdentifier(node.name)) return `"${node.name.text}"`;
  if (node.kind === ts.SyntaxKind.Constructor) return "constructor";
  const p = node.parent;
  if (p && ts.isVariableDeclaration(p) && ts.isIdentifier(p.name)) {
    return `"${p.name.text}"`;
  }
  if (
    p &&
    (ts.isPropertyAssignment(p) || ts.isPropertyDeclaration(p)) &&
    p.name
  ) {
    return `"${p.name.getText()}"`;
  }
  return "(anonymous)";
}

function isThisParameter(param) {
  return ts.isIdentifier(param.name) && param.name.text === "this";
}

function parameterCount(node) {
  return node.parameters.filter((p) => !isThisParameter(p)).length;
}

function isCountableStatement(node) {
  return (
    node.kind >= ts.SyntaxKind.FirstStatement &&
    node.kind <= ts.SyntaxKind.LastStatement &&
    node.kind !== ts.SyntaxKind.Block
  );
}

function decisionPoints(node) {
  switch (node.kind) {
    case ts.SyntaxKind.IfStatement:
    case ts.SyntaxKind.ForStatement:
    case ts.SyntaxKind.ForInStatement:
    case ts.SyntaxKind.ForOfStatement:
    case ts.SyntaxKind.WhileStatement:
    case ts.SyntaxKind.DoStatement:
    case ts.SyntaxKind.CaseClause:
    case ts.SyntaxKind.CatchClause:
    case ts.SyntaxKind.ConditionalExpression:
      return 1;
    case ts.SyntaxKind.BinaryExpression: {
      const op = node.operatorToken.kind;
      const branching =
        op === ts.SyntaxKind.AmpersandAmpersandToken ||
        op === ts.SyntaxKind.BarBarToken ||
        op === ts.SyntaxKind.QuestionQuestionToken;
      return branching ? 1 : 0;
    }
    default:
      return 0;
  }
}

function walkOwnBody(body, visit) {
  const recurse = (node) => {
    ts.forEachChild(node, (child) => {
      if (isFnLike(child)) return;
      visit(child);
      recurse(child);
    });
  };
  recurse(body);
}

function statementCount(body) {
  let count = 0;
  walkOwnBody(body, (node) => {
    if (isCountableStatement(node)) count++;
  });
  return count;
}

function cyclomaticComplexity(body) {
  let complexity = 1;
  walkOwnBody(body, (node) => {
    complexity += decisionPoints(node);
  });
  return complexity;
}

function codeLineCount(strippedLines, startLine, endLine) {
  let lines = 0;
  for (let i = startLine; i <= endLine; i++) {
    if ((strippedLines[i] ?? "").trim() !== "") lines++;
  }
  return lines;
}

export function parseSourceFile(path, src) {
  const scriptKind =
    path.endsWith(".tsx") || path.endsWith(".jsx")
      ? ts.ScriptKind.TSX
      : undefined;
  return ts.createSourceFile(
    path,
    src,
    ts.ScriptTarget.Latest,
    true,
    scriptKind,
  );
}

export function analyzeSource(path, src) {
  const sf = parseSourceFile(path, src);
  const strippedLines = stripStringsAndComments(src).split("\n");
  const fns = [];
  const visit = (node) => {
    if (isFnLike(node) && node.body) {
      const start = sf.getLineAndCharacterOfPosition(node.getStart(sf));
      const endLine = sf.getLineAndCharacterOfPosition(node.getEnd()).line;
      fns.push({
        name: functionName(node),
        startLine: start.line + 1,
        endLine: endLine + 1,
        col: start.character + 1,
        lines: codeLineCount(strippedLines, start.line, endLine),
        statements: statementCount(node.body),
        complexity: cyclomaticComplexity(node.body),
        params: parameterCount(node),
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return fns;
}

export async function stagedAddedLines(path, cwd) {
  const { stdout } = await execFileAsync(
    "git",
    ["diff", "--cached", "-U0", "--", path],
    { cwd, encoding: "utf8", env: sanitizedGitEnv() },
  );
  const added = new Set();
  const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/gm;
  let m;
  while ((m = hunk.exec(stdout)) !== null) {
    const start = Number(m[1]);
    const len = m[2] === undefined ? 1 : Number(m[2]);
    for (let i = 0; i < len; i++) added.add(start + i);
  }
  return added;
}

export function functionsInDiff(fns, addedLines) {
  return fns.filter((fn) => {
    for (let ln = fn.startLine; ln <= fn.endLine; ln++) {
      if (addedLines.has(ln)) return true;
    }
    return false;
  });
}

function usage(script) {
  process.stderr.write(
    `Usage (JS/TS only — .rs/.cs are not analyzed):\n` +
      `  node scripts/hooks/${script}.mjs --staged   (diff-scoped: only functions you added/modified)\n` +
      `  node scripts/hooks/${script}.mjs --all       (audit every function)\n` +
      `  node scripts/hooks/${script}.mjs --files <path> [...]\n`,
  );
}

function resolveFiles(mode, args, script) {
  if (mode === "--staged") return listStagedFiles();
  if (mode === "--all") return listAllFiles();
  if (mode === "--files") return args.slice(1);
  usage(script);
  process.exit(2);
}

async function fileViolations(path, metric, limit, meta, staged) {
  let src;
  try {
    src = await readFile(path, "utf8");
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
  let fns = analyzeSource(path, src);
  if (staged) fns = functionsInDiff(fns, await stagedAddedLines(path));
  return fns
    .filter((fn) => fn[metric] > limit)
    .map((fn) => ({
      path,
      line: fn.startLine,
      col: fn.col,
      kind: meta.flag,
      detail: `fn ${fn.name} has ${fn[metric]} ${meta.noun} (limit ${limit})`,
    }));
}

function report(meta, limit, mode, violations) {
  if (jsonMode()) return emitJson(violations);
  if (violations.length === 0) {
    const where = mode === "--staged" ? " in staged diff" : "";
    process.stdout.write(
      `${meta.script}: no ${meta.flag} violations${where}.\n`,
    );
    return;
  }
  for (const v of violations) process.stderr.write(`${formatViolation(v)}\n`);
  process.stderr.write(
    `\n${meta.script}: ${violations.length} violation(s). Limit is ${limit} ${meta.noun} per function — ${meta.advice}.\n`,
  );
  process.exit(1);
}

// `resolveConfig(slug)` returns the rule's effective config (global overlaid by
// the default project) so a panel edit to the threshold reaches the check. It
// defaults to an empty resolver — direct callers (and tests) get the built-in
// FN_LIMITS default; the check's `main` passes the DB-backed config bridge.
export async function runMetricHook(
  metric,
  argv,
  resolveConfig = async () => ({}),
) {
  const meta = METRIC_META[metric];
  const config = await resolveConfig(meta.script);
  const limit = config[meta.configKey] ?? FN_LIMITS[metric];
  const args = argv.slice(2);
  const mode = args[0];
  const files = await resolveFiles(mode, args, meta.script);
  const targets = files.filter(isAnalyzable);
  const perFile = await Promise.all(
    targets.map((path) =>
      fileViolations(path, metric, limit, meta, mode === "--staged"),
    ),
  );
  report(meta, limit, mode, perFile.flat());
}
