import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  emitJson,
  formatViolation,
  jsonMode,
  listStagedFiles,
  repoRootOf,
  sanitizedGitEnv,
} from "./lint-shared.mjs";

const execFileAsync = promisify(execFile);

/**
 * The mode dispatch every ratcheted duplication hook shares. `--push`/`--staged`
 * resolve the changed-file set + diff args and hand them to the hook's own
 * `ratchetGate`; `--all`/`--files` defer to the hook's report-mode callbacks.
 */
async function runFilesMode(repoRoot, argv, { tool, fileFilter, collectFiles }) {
  const files = argv.slice(3).filter(fileFilter);
  if (files.length === 0) {
    if (jsonMode()) return emitJson([]);
    process.stdout.write(`${tool}: no code files given.\n`);
    return;
  }
  const violations = await collectFiles(repoRoot, files);
  if (jsonMode()) return emitJson(violations);
  if (violations.length === 0) {
    process.stdout.write(`${tool}: no violations in the given files.\n`);
    return;
  }
  for (const v of violations) process.stderr.write(`${formatViolation(v)}\n`);
  process.exit(1);
}

export async function runRatchetHook(
  argv,
  { tool, ratchetGate, runAll, fileFilter, collectFiles, usage },
) {
  const repoRoot = await repoRootOf(process.cwd());
  const warn = argv.includes("--warn");
  const mode = argv[2];
  if (mode === "--push") {
    const inputs = await pushRatchetInputs(repoRoot, tool);
    if (inputs === null) return;
    return ratchetGate({ repoRoot, ...inputs, warn });
  }
  if (mode === "--staged") {
    const staged = await listStagedFiles(repoRoot);
    return ratchetGate({
      repoRoot,
      changedFiles: staged,
      diffArgs: ["--cached"],
      label: "staged diff",
      warn,
    });
  }
  if (mode === "--all") return runAll(repoRoot);
  if (mode === "--files") {
    return runFilesMode(repoRoot, argv, { tool, fileFilter, collectFiles });
  }
  usage();
  process.exit(2);
}

/**
 * Shared reporting tail for both duplication ratchets: nothing → `okLine`; else
 * print each violation, then either `warnLine` (advisory, exit 0) or `summaryLine`
 * (blocking, exit 1). `okLine`/`summaryLine`/`warnLine` carry their own leading
 * newlines; this appends the trailing one.
 */
export function reportRatchetViolations(
  violations,
  { okLine, summaryLine, warnLine },
) {
  if (violations.length === 0) {
    process.stdout.write(`${okLine}\n`);
    return;
  }
  for (const v of violations) process.stderr.write(`${formatViolation(v)}\n`);
  if (warnLine) {
    process.stderr.write(`${warnLine}\n`);
    return;
  }
  process.stderr.write(`${summaryLine}\n`);
  process.exit(1);
}

export function parseAddedLineRanges(diffText) {
  const ranges = [];
  const re = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/gm;
  let m;
  while ((m = re.exec(diffText)) !== null) {
    const start = Number(m[1]);
    const count = m[2] === undefined ? 1 : Number(m[2]);
    if (count > 0) ranges.push([start, start + count - 1]);
  }
  return ranges;
}

export function rangesOverlap([start, end], ranges) {
  return ranges.some(([s, e]) => start <= e && end >= s);
}

export async function pushBase(repoRoot) {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["merge-base", "HEAD", "origin/main"],
      { cwd: repoRoot, encoding: "utf8", env: sanitizedGitEnv() },
    );
    return stdout.trim();
  } catch (err) {
    if (
      /Not a valid object name|no merge base|unknown revision/i.test(
        err.stderr ?? "",
      )
    ) {
      return null;
    }
    throw err;
  }
}

async function renameMap(repoRoot, diffArgs) {
  const { stdout } = await execFileAsync(
    "git",
    ["diff", "--name-status", "-M", ...diffArgs],
    { cwd: repoRoot, encoding: "utf8", env: sanitizedGitEnv() },
  );
  const map = new Map();
  for (const line of stdout.split("\n")) {
    const [status, oldPath, newPath] = line.split("\t");
    if (status?.startsWith("R") && newPath) map.set(newPath, oldPath);
  }
  return map;
}

/**
 * Shared `--push` setup for both duplication ratchets: resolve the origin/main
 * merge-base and the files changed since it. Returns null (after printing a skip
 * notice under `tool`) when origin/main is absent, so callers just early-return.
 */
export async function pushRatchetInputs(repoRoot, tool) {
  const base = await pushBase(repoRoot);
  if (base === null) {
    process.stdout.write(
      `${tool}: origin/main not found — skipping push ratchet (fetch origin to enable).\n`,
    );
    return null;
  }
  const { stdout } = await execFileAsync(
    "git",
    ["diff", "--name-only", "--diff-filter=ACMR", base, "HEAD"],
    { cwd: repoRoot, encoding: "utf8", env: sanitizedGitEnv() },
  );
  return {
    changedFiles: stdout.split("\n").filter(Boolean),
    diffArgs: [base, "HEAD"],
    label: `${base.slice(0, 8)}..HEAD`,
  };
}

export async function collectAddedRanges(repoRoot, files, diffArgs) {
  const renames = await renameMap(repoRoot, diffArgs);
  const map = new Map();
  for (const file of files) {
    const oldPath = renames.get(file);
    const pathspec = oldPath ? [oldPath, file] : [file];
    const { stdout } = await execFileAsync(
      "git",
      ["diff", "--unified=0", "-M", ...diffArgs, "--", ...pathspec],
      { cwd: repoRoot, encoding: "utf8", env: sanitizedGitEnv() },
    );
    map.set(file, parseAddedLineRanges(stdout));
  }
  return map;
}
