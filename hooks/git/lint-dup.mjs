#!/usr/bin/env node
import { execFile } from "node:child_process";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, isAbsolute, join, relative, resolve } from "node:path";
import { promisify } from "node:util";
import {
  collectAddedRanges,
  pushRatchetInputs,
  rangesOverlap,
  reportRatchetViolations,
} from "./dup-ratchet.mjs";
import {
  EXCLUDED_PATH_PARTS,
  emitJson,
  isInvokedAsScript,
  jsonMode,
  listStagedFiles,
  repoRootOf,
  resolveToolBin,
} from "./lint-shared.mjs";
import { JSCPD_FORMAT_BY_EXT } from "../../lib/languages.mjs";

const execFileAsync = promisify(execFile);

export const MIN_TOKENS = 50;
export const MIN_LINES = 5;

export { JSCPD_FORMAT_BY_EXT };

const GENERATED_IGNORE_GLOBS = [
  "**/generated/**",
  "**/samples/**",
  "**/version-*/**",
  "**/migrations/**",
  "**/*.min.*",
  // Vendored byte-for-byte from emitter-sdk/src by vendor-skill-libs.mjs (build-skills-dist asserts identity), so pairing any of it with its source is a false positive. Gitignored + regenerated, present only after test:skills/build:skills runs.
  "**/skills/deterministic/scripts/lib/**",
];

export function jscpdIgnoreGlobs() {
  const fromShared = EXCLUDED_PATH_PARTS.map(
    (p) => `**/${p.replace(/^\/|\/$/g, "")}/**`,
  );
  return [...new Set([...fromShared, "**/.git/**", ...GENERATED_IGNORE_GLOBS])];
}

export function parseJscpdReport(json) {
  const parsed = JSON.parse(json);
  if (!Array.isArray(parsed.duplicates)) {
    throw new Error("invariant: jscpd report has no `duplicates` array");
  }
  return parsed.duplicates;
}

function toRepoRelative(name, repoRoot) {
  return isAbsolute(name) ? relative(repoRoot, name) : name;
}

// A line that is one member of a multi-line import: a bare identifier (opt. `as X`, opt. trailing comma), a lone `{`, or a `}`/`} from "…";` closer. Used to recognize a clone that BEGINS inside a multi-line import.
const IMPORT_MEMBER_RE =
  /^(\{|[A-Za-z_$][\w$]*(\s+as\s+[A-Za-z_$][\w$]*)?,?|\}\s*(from\s+["'][^"']+["'];?)?)$/;

/**
 * A cloned block that is nothing but `import` statements (incl. multi-line
 * ones, and clones that begin or end partway through one) isn't extractable
 * duplication — separate modules legitimately repeat the same imports — so
 * jscpd matching them is a false positive we skip. Requires at least one real
 * import boundary (`import` / `from`) so a plain identifier list (e.g. a
 * duplicated array literal) is NOT treated as import-only.
 */
// Advance the import-scan `state` over one trimmed line; returns false when the line is not import syntax (so the fragment has real code).
function stepImportScan(state, line) {
  const hasFrom = /\bfrom\b/.test(line);
  if (state.inImport) {
    if (hasFrom || line.endsWith(";")) {
      state.inImport = false;
      if (hasFrom) state.sawImport = true;
    }
    return true;
  }
  if (/^import\b/.test(line) || /^export\b.*\bfrom\b/.test(line)) {
    state.sawImport = true;
    state.inImport = !hasFrom;
    return true;
  }
  if (IMPORT_MEMBER_RE.test(line)) {
    if (hasFrom) state.sawImport = true;
    else state.inImport = true;
    return true;
  }
  return false;
}

export function isImportOnlyFragment(fragment) {
  if (typeof fragment !== "string") return false;
  const lines = fragment
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "" && !l.startsWith("//"));
  if (lines.length === 0) return false;
  const state = { inImport: false, sawImport: false };
  for (const line of lines) {
    if (!stepImportScan(state, line)) return false;
  }
  return state.sawImport;
}

async function isImportOnlyBlock(repoRoot, side) {
  const text = await readFile(resolve(repoRoot, side.path), "utf8").catch(
    () => null,
  );
  if (text === null) return false;
  const block = text
    .split("\n")
    .slice(side.start - 1, side.end)
    .join("\n");
  return isImportOnlyFragment(block);
}

export async function selectNewClones(duplicates, addedRangesByFile, repoRoot) {
  const violations = [];
  for (const dup of duplicates) {
    const a = {
      path: toRepoRelative(dup.firstFile.name, repoRoot),
      start: dup.firstFile.start,
      end: dup.firstFile.end,
    };
    const b = {
      path: toRepoRelative(dup.secondFile.name, repoRoot),
      start: dup.secondFile.start,
      end: dup.secondFile.end,
    };
    const stagedSide = [a, b].find((side) => {
      const added = addedRangesByFile.get(side.path);
      return added && rangesOverlap([side.start, side.end], added);
    });
    if (!stagedSide) continue;
    if (await isImportOnlyBlock(repoRoot, stagedSide)) continue;
    const other = stagedSide === a ? b : a;
    violations.push({
      path: stagedSide.path,
      line: stagedSide.start,
      col: 1,
      kind: `duplicate code (${dup.lines} lines)`,
      detail: `this staged block duplicates ${other.path}:${other.start}-${other.end}. Extract a shared helper instead of copying — see CLAUDE.md "DRY — ZERO TOLERANCE, HALT ON THE SECOND COPY".`,
    });
  }
  return violations;
}

async function jscpdScan({ scanPath, extraIgnore, formats, repoRoot, bin }) {
  const outDir = await mkdtemp(join(tmpdir(), "lint-dup-"));
  try {
    await execFileAsync(
      process.execPath,
      [
        bin,
        scanPath,
        "--min-tokens",
        String(MIN_TOKENS),
        "--min-lines",
        String(MIN_LINES),
        "--absolute",
        "--silent",
        "--reporters",
        "json",
        "--output",
        outDir,
        "--ignore",
        [...jscpdIgnoreGlobs(), ...extraIgnore].join(","),
        "--format",
        formats.join(","),
      ],
      { cwd: repoRoot, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
    );
    const report = await readFile(join(outDir, "jscpd-report.json"), "utf8");
    return parseJscpdReport(report);
  } finally {
    await rm(outDir, { force: true, recursive: true });
  }
}

/** The frontend is a browser build that cannot import server-side (backend/typescript/scripts) code, so a block shared across that boundary is an unavoidable wire-contract mirror, not a fixable copy. Scanning `frontend/` in isolation from everything-else keeps those false pairs from forming while still catching all within-frontend and within/across-server duplication (backend↔typescript et al. genuinely share code). */
async function runJscpd(formats, repoRoot) {
  const bin = await resolveToolBin("jscpd");
  const duplicates = [];
  const hasFrontend = await access(join(repoRoot, "frontend")).then(
    () => true,
    () => false,
  );
  if (hasFrontend) {
    duplicates.push(
      ...(await jscpdScan({
        scanPath: "frontend",
        extraIgnore: [],
        formats,
        repoRoot,
        bin,
      })),
    );
  }
  duplicates.push(
    ...(await jscpdScan({
      scanPath: ".",
      extraIgnore: ["**/frontend/**"],
      formats,
      repoRoot,
      bin,
    })),
  );
  return duplicates;
}

export const JS_TS_FORMAT_FAMILY = ["typescript", "tsx", "javascript", "jsx"];

/** Handed a lone "tsx" scan format, jscpd follows the workspace self-symlink (node_modules/@deterministic-code/deterministic -> repo root) into an infinite loop and dies with ENAMETOOLONG before writing a report; scanning the whole JS/TS family together dodges the degenerate case and is anyway correct — a .tsx block can duplicate a .ts one. */
export function formatsFor(files) {
  const formats = new Set();
  for (const f of files) {
    const fmt = JSCPD_FORMAT_BY_EXT[extname(f)];
    if (fmt) formats.add(fmt);
  }
  if (JS_TS_FORMAT_FAMILY.some((fmt) => formats.has(fmt))) {
    for (const fmt of JS_TS_FORMAT_FAMILY) formats.add(fmt);
  }
  return [...formats];
}

async function ratchetGate({ repoRoot, changedFiles, diffArgs, label }) {
  const codeFiles = changedFiles.filter((f) => JSCPD_FORMAT_BY_EXT[extname(f)]);
  if (codeFiles.length === 0) {
    process.stdout.write(`lint-dup: no ${label} code files.\n`);
    return;
  }
  const duplicates = await runJscpd(formatsFor(codeFiles), repoRoot);
  const addedRanges = await collectAddedRanges(repoRoot, codeFiles, diffArgs);
  const violations = await selectNewClones(duplicates, addedRanges, repoRoot);
  reportRatchetViolations(violations, {
    okLine: `lint-dup: no newly-introduced duplication in ${label}.`,
    summaryLine: `\nlint-dup: ${violations.length} newly-introduced duplicate block(s). Rule: no second copy — extract a shared helper in this same change. See CLAUDE.md "DRY — ZERO TOLERANCE".`,
  });
}

function printDuplicatePairs(duplicates, repoRoot, write) {
  for (const dup of duplicates) {
    const a = toRepoRelative(dup.firstFile.name, repoRoot);
    const b = toRepoRelative(dup.secondFile.name, repoRoot);
    write(
      `${a}:${dup.firstFile.start}-${dup.firstFile.end} <-> ${b}:${dup.secondFile.start}-${dup.secondFile.end}  (${dup.lines} lines)\n`,
    );
  }
}

function duplicatesToViolations(duplicates, repoRoot) {
  return duplicates.map((dup) => ({
    path: toRepoRelative(dup.firstFile.name, repoRoot),
    line: dup.firstFile.start,
    col: 1,
    kind: `duplicate code (${dup.lines} lines)`,
    detail: `duplicates ${toRepoRelative(dup.secondFile.name, repoRoot)}:${dup.secondFile.start}-${dup.secondFile.end}. Extract a shared helper instead of copying.`,
  }));
}

async function runStagedMode(repoRoot) {
  const staged = await listStagedFiles(repoRoot);
  await ratchetGate({
    repoRoot,
    changedFiles: staged,
    diffArgs: ["--cached"],
    label: "staged diff",
  });
}

async function runPushMode(repoRoot) {
  const inputs = await pushRatchetInputs(repoRoot, "lint-dup");
  if (inputs === null) return;
  await ratchetGate({ repoRoot, ...inputs });
}

async function runAllMode(repoRoot) {
  const duplicates = await runJscpd(
    [...new Set(Object.values(JSCPD_FORMAT_BY_EXT))],
    repoRoot,
  );
  if (jsonMode()) return emitJson(duplicatesToViolations(duplicates, repoRoot));
  if (duplicates.length === 0) {
    process.stdout.write("lint-dup: no duplication found.\n");
    return;
  }
  printDuplicatePairs(duplicates, repoRoot, (s) => process.stdout.write(s));
  process.stdout.write(
    `\nlint-dup: ${duplicates.length} duplicate block(s) (report-only; --push is the ratchet gate).\n`,
  );
}

async function runFilesMode(repoRoot, argv) {
  const files = argv.slice(3).filter((f) => JSCPD_FORMAT_BY_EXT[extname(f)]);
  if (files.length === 0) {
    if (jsonMode()) return emitJson([]);
    process.stdout.write("lint-dup: no code files given.\n");
    return;
  }
  const duplicates = await runJscpd(formatsFor(files), repoRoot);
  const targets = new Set(files.map((f) => relative(repoRoot, resolve(f))));
  const hits = duplicates.filter(
    (d) =>
      targets.has(toRepoRelative(d.firstFile.name, repoRoot)) ||
      targets.has(toRepoRelative(d.secondFile.name, repoRoot)),
  );
  if (jsonMode()) return emitJson(duplicatesToViolations(hits, repoRoot));
  if (hits.length === 0) {
    process.stdout.write("lint-dup: no duplication in the given files.\n");
    return;
  }
  printDuplicatePairs(hits, repoRoot, (s) => process.stderr.write(s));
  process.exit(1);
}

const DUP_MODES = {
  "--staged": runStagedMode,
  "--push": runPushMode,
  "--all": runAllMode,
};

export async function main(argv) {
  const repoRoot = await repoRootOf(process.cwd());
  const handler = DUP_MODES[argv[2]];
  if (handler) return handler(repoRoot);
  if (argv[2] === "--files") return runFilesMode(repoRoot, argv);
  process.stderr.write(
    "Usage:\n  node scripts/hooks/lint-dup.mjs --push\n  node scripts/hooks/lint-dup.mjs --staged\n  node scripts/hooks/lint-dup.mjs --all\n  node scripts/hooks/lint-dup.mjs --files <path> [...]\n",
  );
  process.exit(2);
}

/* v8 ignore next 6 */
if (isInvokedAsScript(import.meta.url)) {
  main(process.argv).catch((err) => {
    process.stderr.write(`lint-dup: ${err.message ?? err}\n`);
    process.exit(2);
  });
}
