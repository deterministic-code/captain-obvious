#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  emitJson,
  formatViolation,
  isInvokedAsScript,
  isLintable,
  jsonMode,
  listAllFiles,
  listStagedFiles,
  stripStringsAndComments,
} from "@deterministic-code/co-rule-kit/lint-shared";

export {
  SUPPORTED_EXTS,
  EXCLUDED_PATH_PARTS,
  isExcluded,
  isLintable,
  stripStringsAndComments,
} from "@deterministic-code/co-rule-kit/lint-shared";

export function findViolations(src) {
  const stripped = stripStringsAndComments(src);
  const violations = [];
  const re = /\bcatch\s*(?:\([^)]*\))?\s*\{/g;
  let m;
  while ((m = re.exec(stripped)) !== null) {
    const openIdx = stripped.indexOf("{", m.index);
    // Unreachable: the catch regex guarantees a following "{", so indexOf never returns -1.
    /* v8 ignore next */
    if (openIdx === -1) continue;
    let depth = 1;
    let j = openIdx + 1;
    while (j < stripped.length && depth > 0) {
      const ch = stripped[j];
      if (ch === "{") depth++;
      else if (ch === "}") depth--;
      if (depth === 0) break;
      j++;
    }
    if (depth !== 0) continue;
    const body = stripped.slice(openIdx + 1, j);
    if (body.trim() === "") {
      const line = src.slice(0, m.index).split("\n").length;
      const col = m.index - src.lastIndexOf("\n", m.index - 1);
      violations.push({
        line,
        col,
        kind: "empty catch block",
        detail:
          "catch body is empty or comment-only. Forbidden by CLAUDE.md. Replace with a non-throwing predicate (existsSync, Map.has), a narrow rethrow (if (err.code === 'ENOENT') return null; throw err), an API opt-out (fs.rm {force:true}), a test-framework assertion (expect.toThrow), or a logged warning that contains a real statement.",
      });
    }
  }
  return violations;
}

export async function lintFile(path, cwd) {
  const absPath = cwd ? resolve(cwd, path) : path;
  let src;
  try {
    src = await readFile(absPath, "utf8");
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
  return findViolations(src).map((v) => ({ ...v, path }));
}

export { formatViolation };

export async function main(argv, opts = {}) {
  const cwd = opts.cwd;
  const args = argv.slice(2);
  const mode = args[0];
  let files;
  if (mode === "--staged") {
    files = await listStagedFiles(cwd);
  } else if (mode === "--all") {
    files = await listAllFiles(cwd);
  } else if (mode === "--files") {
    files = args.slice(1);
  } else {
    process.stderr.write(
      "Usage:\n  node scripts/hooks/lint-empty-catch.mjs --staged\n  node scripts/hooks/lint-empty-catch.mjs --all\n  node scripts/hooks/lint-empty-catch.mjs --files <path> [...]\n",
    );
    process.exit(2);
  }
  const targets = files.filter((p) => isLintable(p));
  const violations = (
    await Promise.all(targets.map((p) => lintFile(p, cwd)))
  ).flat();
  if (jsonMode()) return emitJson(violations);
  if (violations.length === 0) {
    if (mode === "--staged")
      process.stdout.write(
        "lint-empty-catch: no empty catch blocks in staged diff.\n",
      );
    else if (mode === "--all")
      process.stdout.write(
        "lint-empty-catch: no empty catch blocks in repo.\n",
      );
    return;
  }
  for (const v of violations) process.stderr.write(`${formatViolation(v)}\n`);
  process.stderr.write(
    `\nlint-empty-catch: ${violations.length} violation(s). Rule: catch bodies must contain a real statement. See CLAUDE.md “EMPTY CATCH BLOCKS”.\n`,
  );
  process.exit(1);
}

/* v8 ignore next 6 */
if (isInvokedAsScript(import.meta.url)) {
  main(process.argv).catch((err) => {
    process.stderr.write(`lint-empty-catch: ${err.message ?? err}\n`);
    process.exit(2);
  });
}
