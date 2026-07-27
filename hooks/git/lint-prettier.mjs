#!/usr/bin/env node
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  formatViolation,
  isInvokedAsScript,
  isLintable,
  listAllFiles,
  listStagedFiles,
  repoRootOf,
  resolveToolBin,
  sanitizedGitEnv,
} from "./lint-shared.mjs";

const execFileAsync = promisify(execFile);

const USAGE = `Usage:
  node hooks/git/lint-prettier.mjs --staged
  node hooks/git/lint-prettier.mjs --all
  node hooks/git/lint-prettier.mjs --files <path> [...]
  node hooks/git/lint-prettier.mjs [--staged|--all] --warn
  node hooks/git/lint-prettier.mjs --fix [--staged|--all|--files <path> ...]
`;

/**
 * Parse argv (post `node script`) into an operation + file selection. `--fix`
 * anywhere selects the fix operation; otherwise it's a check. The selector
 * (`--staged`/`--all`/`--files`) is shared by both; `--fix` alone defaults to
 * `--staged`. Returns null on an unrecognized selector.
 */
export function selectMode(args) {
  const op = args.includes("--fix") ? "fix" : "check";
  const warn = args.includes("--warn");
  const rest = args.filter((a) => a !== "--fix" && a !== "--warn");
  let selector = rest[0];
  if (selector === undefined && op === "fix") selector = "--staged";
  if (selector !== "--staged" && selector !== "--all" && selector !== "--files") {
    return null;
  }
  const files = selector === "--files" ? rest.slice(1) : [];
  return { op, selector, warn, files };
}

/** Parse `prettier --check` output into one violation per unformatted file. */
export function parsePrettierCheckOutput(text) {
  const violations = [];
  for (const line of text.split("\n")) {
    const m = line.match(/^\[warn\]\s+(.+?)\s*$/);
    if (m && !/Code style issues/i.test(line)) {
      violations.push({
        path: m[1],
        line: 1,
        col: 1,
        kind: "not prettier-formatted",
        detail:
          "file is not Prettier-formatted; run the fix action (prettier --write) or `--fix`.",
      });
    }
  }
  return violations;
}

/** True when prettier reported a hard failure (e.g. a syntax error), not just unformatted files. */
function looksLikeToolError(text) {
  return /^\[error\]/m.test(text);
}

async function selectFiles(selector, files, repoRoot) {
  let list;
  if (selector === "--staged") list = await listStagedFiles(repoRoot);
  else if (selector === "--all") list = await listAllFiles(repoRoot);
  else list = files;
  return list.filter(isLintable);
}

async function runCheck(bin, targets, repoRoot, warn) {
  let stdout = "";
  let stderr = "";
  try {
    const res = await execFileAsync(
      process.execPath,
      [bin, "--check", "--no-color", ...targets],
      {
        cwd: repoRoot,
        encoding: "utf8",
        env: sanitizedGitEnv(),
        maxBuffer: 64 * 1024 * 1024,
      },
    );
    stdout = res.stdout;
    stderr = res.stderr;
  } catch (err) {
    // prettier exits 1 when files are unformatted (expected) and 2 on real
    // errors. Distinguish by content: an [error] line is a genuine failure.
    stdout = err.stdout ?? "";
    stderr = err.stderr ?? "";
    if (typeof err.code !== "number" || looksLikeToolError(stdout + stderr)) {
      throw new Error(`prettier failed: ${(stderr || stdout || err.message).trim()}`);
    }
  }
  const violations = parsePrettierCheckOutput(stdout + stderr);
  if (violations.length === 0) {
    process.stdout.write("lint-prettier: all files formatted.\n");
    return;
  }
  for (const v of violations) process.stderr.write(`${formatViolation(v)}\n`);
  if (warn) {
    process.stderr.write(
      `\n⚠ lint-prettier: ${violations.length} unformatted file(s) (advisory — not blocking this commit yet)\n`,
    );
    return;
  }
  process.stderr.write(
    `\nlint-prettier: ${violations.length} unformatted file(s). Run the fix action (prettier --write) or \`--fix\`.\n`,
  );
  process.exit(1);
}

async function runFix(bin, targets, repoRoot) {
  await execFileAsync(process.execPath, [bin, "--write", "--no-color", ...targets], {
    cwd: repoRoot,
    encoding: "utf8",
    env: sanitizedGitEnv(),
    maxBuffer: 64 * 1024 * 1024,
  });
  process.stdout.write(
    `lint-prettier: formatted ${targets.length} file(s) with prettier --write. Re-stage them with \`git add\`.\n`,
  );
}

export async function main(argv) {
  const parsed = selectMode(argv.slice(2));
  if (parsed === null) {
    process.stderr.write(USAGE);
    process.exit(2);
  }
  const repoRoot = await repoRootOf(process.cwd());
  const targets = await selectFiles(parsed.selector, parsed.files, repoRoot);
  if (targets.length === 0) {
    process.stdout.write("lint-prettier: no lintable files.\n");
    return;
  }
  const bin = await resolveToolBin("prettier");
  if (parsed.op === "fix") return runFix(bin, targets, repoRoot);
  return runCheck(bin, targets, repoRoot, parsed.warn);
}

/* v8 ignore next 6 */
if (isInvokedAsScript(import.meta.url)) {
  main(process.argv).catch((err) => {
    process.stderr.write(`lint-prettier: ${err.message ?? err}\n`);
    process.exit(2);
  });
}
