#!/usr/bin/env node
import {
  formatViolation,
  isInvokedAsScript,
  isLintable,
  lintFileWith,
  runFileHook,
  stripStringsAndComments,
} from "./lint-shared.mjs";

export {
  isExcluded,
  isLintable,
  stripStringsAndComments,
} from "./lint-shared.mjs";

// JS/TS declarations only — Rust (.rs) is snake_case and C# (.cs) is PascalCase by their own conventions.
export const NAMING_EXTS = new Set([
  ".ts",
  ".tsx",
  ".mjs",
  ".cjs",
  ".js",
  ".jsx",
]);

// Judge case on the core — leading/trailing underscores (__dirname, _unused) are a deliberate convention.
const core = (name) => name.replace(/^_+/, "").replace(/_+$/, "");

export const isPascalCase = (name) => /^[A-Z][A-Za-z0-9]*$/.test(core(name));
const isUpperSnake = (name) => /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*$/.test(name);
// Values are camelCase, PascalCase (React components / factories), or UPPER_SNAKE — never snake_case.
export const isValueCase = (name) =>
  /^[A-Za-z][A-Za-z0-9]*$/.test(core(name)) || isUpperSnake(name);

const TYPE_LIKE = [
  { re: /\b(class|interface|enum)\s+([A-Za-z_$][\w$]*)/g, nameGroup: 2, kw: 1 },
  { re: /\btype\s+([A-Za-z_$][\w$]*)\s*[=<]/g, nameGroup: 1, kw: null },
];

const VALUE_DECLS = [
  [/\bfunction\s*\*?\s+([A-Za-z_$][\w$]*)/g, "function", "functions"],
  [/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/g, "value", "variables"],
];

function locator(src) {
  return (idx) => ({
    line: src.slice(0, idx).split("\n").length,
    col: idx - src.lastIndexOf("\n", idx - 1),
  });
}

function scanTypeLike(stripped, at) {
  const violations = [];
  for (const { re, nameGroup, kw } of TYPE_LIKE) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(stripped)) !== null) {
      const name = m[nameGroup];
      if (isPascalCase(name)) continue;
      const keyword = kw === null ? "type" : m[kw];
      violations.push({
        ...at(m.index),
        kind: `${keyword} name not PascalCase`,
        detail: `\`${name}\` — classes, interfaces, type aliases, and enums use PascalCase (e.g. EmitPlan). Rename the declaration.`,
      });
    }
  }
  return violations;
}

function scanValues(stripped, at) {
  const violations = [];
  for (const [re, kind, label] of VALUE_DECLS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(stripped)) !== null) {
      const name = m[1];
      if (isValueCase(name)) continue;
      violations.push({
        ...at(m.index),
        kind: `${kind} name is snake_case`,
        detail: `\`${name}\` — ${label} use camelCase (or PascalCase for components, UPPER_SNAKE for constants), never snake_case. Rename the declaration.`,
      });
    }
  }
  return violations;
}

export function findViolations(src) {
  const stripped = stripStringsAndComments(src);
  const at = locator(src);
  return [...scanTypeLike(stripped, at), ...scanValues(stripped, at)];
}

export const lintFile = (path, cwd) => lintFileWith(path, cwd, findViolations);

export { formatViolation };

function usage() {
  process.stderr.write(
    "Usage:\n  node scripts/hooks/lint-naming.mjs --staged\n  node scripts/hooks/lint-naming.mjs --all\n  node scripts/hooks/lint-naming.mjs --files <path> [...]\n",
  );
}

export function main(argv) {
  return runFileHook(argv, {
    usage,
    collect: (path) =>
      isLintable(path, { exts: NAMING_EXTS }) ? lintFile(path) : [],
    okLine: "lint-naming: no naming violations",
    summary: (n) =>
      `lint-naming: ${n} violation(s). Rule: type-likes are PascalCase; functions/variables are camelCase (never snake_case). See CLAUDE.md “Naming”.`,
  });
}

/* v8 ignore next 6 */
if (isInvokedAsScript(import.meta.url)) {
  main(process.argv).catch((err) => {
    process.stderr.write(`lint-naming: ${err.message ?? err}\n`);
    process.exit(2);
  });
}
