#!/usr/bin/env node
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { basename, dirname, extname, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);

// JS/TS family only. Rust (.rs) and C# (.cs) have their own toolchains (rustfmt/clippy, dotnet format) and conventions, so the Node lint hooks do not police them.
export const SUPPORTED_EXTS = new Set([
  ".ts",
  ".tsx",
  ".mjs",
  ".cjs",
  ".js",
  ".jsx",
]);

export const EXCLUDED_PATH_PARTS = [
  "/node_modules/",
  "/dist/",
  "/target/",
  "/build/",
  "/.worktrees/",
  "/.claude/",
  "/.git/",
  "/.deterministic-cache/",
  "/_deterministic/",
  "/playwright-report/",
  "/coverage/",
  "/samples/demo-backend/",
];

export function isExcluded(path, parts = EXCLUDED_PATH_PARTS) {
  const normalized = `/${path.replace(/^\.?\/+/, "")}`;
  return parts.some((p) => normalized.includes(p));
}

export function isLintable(path, opts = {}) {
  const exts = opts.exts ?? SUPPORTED_EXTS;
  const parts = opts.parts ?? EXCLUDED_PATH_PARTS;
  if (isExcluded(path, parts)) return false;
  return exts.has(extname(path));
}

const REGEX_PRECEDING_KEYWORDS = new Set([
  "return",
  "case",
  "typeof",
  "instanceof",
  "new",
  "in",
  "of",
  "do",
  "else",
  "void",
  "delete",
  "yield",
  "await",
]);

function regexCanStartAfter(out) {
  let j = out.length - 1;
  while (j >= 0 && /\s/.test(out[j])) j--;
  if (j < 0) return true;
  if ("(,=:[!&|?;{}%^~<>+-*".includes(out[j])) return true;
  let k = j;
  while (k >= 0 && /[A-Za-z_$]/.test(out[k])) k--;
  return REGEX_PRECEDING_KEYWORDS.has(out.slice(k + 1, j + 1));
}

export function stripStringsAndComments(src) {
  let out = "";
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const next = src[i + 1];
    if (c === "/" && next === "/") {
      out += "  ";
      i += 2;
      while (i < n && src[i] !== "\n") {
        // Dead ternary arm: the loop guard is src[i] !== "\n", so src[i] === "\n" is never true here.
        /* v8 ignore next */
        out += src[i] === "\n" ? "\n" : " ";
        i++;
      }
      continue;
    }
    if (c === "/" && next === "*") {
      out += "  ";
      i += 2;
      while (i < n && !(src[i] === "*" && src[i + 1] === "/")) {
        out += src[i] === "\n" ? "\n" : " ";
        i++;
      }
      if (i < n) {
        out += "  ";
        i += 2;
      }
      continue;
    }
    // regex literals may contain quote chars — /["']/ would otherwise open a bogus string and unbalance the rest of the file
    if (c === "/" && regexCanStartAfter(out)) {
      out += "/";
      i++;
      let inClass = false;
      while (i < n && src[i] !== "\n") {
        const ch = src[i];
        if (ch === "\\" && i + 1 < n) {
          out += "  ";
          i += 2;
          continue;
        }
        if (inClass) {
          if (ch === "]") inClass = false;
        } else if (ch === "[") {
          inClass = true;
        } else if (ch === "/") {
          break;
        }
        out += " ";
        i++;
      }
      if (i < n && src[i] === "/") {
        out += "/";
        i++;
        while (i < n && /[a-z]/i.test(src[i])) {
          out += src[i];
          i++;
        }
      }
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      const q = c;
      out += q;
      i++;
      while (i < n && src[i] !== q) {
        if (src[i] === "\\" && i + 1 < n) {
          out += "  ";
          i += 2;
          continue;
        }
        // Dead ternary arm: the loop guard is src[i] !== q, so the src[i] === q ? q arm is never taken.
        /* v8 ignore next */
        out += src[i] === "\n" ? "\n" : src[i] === q ? q : " ";
        i++;
      }
      if (i < n) {
        out += q;
        i++;
      }
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

export function sanitizedGitEnv() {
  const out = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (k.startsWith("GIT_")) continue;
    out[k] = v;
  }
  return out;
}

export async function resolveToolBin(pkgName, binName = pkgName) {
  const pkgPath = await resolveToolPackageJson(pkgName);
  const pkg = JSON.parse(await readFile(pkgPath, "utf8"));
  const binRel = typeof pkg.bin === "string" ? pkg.bin : pkg.bin?.[binName];
  if (!binRel) {
    throw new Error(`invariant: ${pkgName} declares no bin for ${binName}`);
  }
  return resolve(dirname(pkgPath), binRel);
}

async function resolveToolPackageJson(pkgName) {
  try {
    return require.resolve(`${pkgName}/package.json`);
  } catch (err) {
    if (err.code === "MODULE_NOT_FOUND") {
      throw new Error(
        `${pkgName} is not installed. Run \`npm install\` so the hook can run.`,
      );
    }
    // Dead: require.resolve on a present-but-unexported pkg only throws ERR_PACKAGE_PATH_NOT_EXPORTED, so the rethrow never fires.
    /* v8 ignore next */
    if (err.code !== "ERR_PACKAGE_PATH_NOT_EXPORTED") throw err;
  }
  const entry = require.resolve(pkgName);
  let dir = dirname(entry);
  const leaf = pkgName.split("/").pop();
  while (true) {
    if (basename(dir) === leaf) return resolve(dir, "package.json");
    const parent = dirname(dir);
    // Unreachable invariant: an installed package's entry dir has basename === leaf before filesystem root.
    /* v8 ignore next 3 */
    if (parent === dir) {
      throw new Error(`invariant: cannot locate package.json for ${pkgName}`);
    }
    dir = parent;
  }
}

export async function repoRootOf(cwd) {
  const { stdout } = await execFileAsync(
    "git",
    ["rev-parse", "--show-toplevel"],
    { cwd, encoding: "utf8", env: sanitizedGitEnv() },
  );
  return stdout.trim();
}

export async function listStagedFiles(cwd) {
  const { stdout } = await execFileAsync(
    "git",
    ["diff", "--cached", "--name-only", "--diff-filter=ACMR"],
    { encoding: "utf8", cwd, env: sanitizedGitEnv() },
  );
  return stdout.split("\n").filter(Boolean);
}

export async function listAllFiles(cwd) {
  const { stdout } = await execFileAsync("git", ["ls-files"], {
    encoding: "utf8",
    cwd,
    env: sanitizedGitEnv(),
  });
  return stdout.split("\n").filter(Boolean);
}

/** Read a source file, tolerating a deleted/directory path as `null` (the file left the diff mid-run). */
export async function readSourceOrNull(path) {
  return readFile(path, "utf8").then(
    (s) => s,
    (err) => {
      if (err.code === "ENOENT" || err.code === "EISDIR") return null;
      throw err;
    },
  );
}

/** Lint one file with a `findViolations(src)` scanner, tagging each result with `.path`. */
export async function lintFileWith(path, cwd, findViolations) {
  const absPath = cwd ? resolve(cwd, path) : path;
  const src = await readSourceOrNull(absPath);
  if (src === null) return [];
  return findViolations(src).map((v) => ({ ...v, path }));
}

export function formatViolation(v) {
  return `${v.path}:${v.line}:${v.col}  ${v.kind}\n    ${v.detail}`;
}

export async function selectHookFiles(mode, args, usage) {
  if (mode === "--staged") return listStagedFiles();
  if (mode === "--all") return listAllFiles();
  if (mode === "--files") return args.slice(1);
  usage();
  process.exit(2);
}

export function emitHookReport(violations, { mode, okLine, summaryLine }) {
  if (violations.length === 0) {
    const where = mode === "--staged" ? " in staged diff" : "";
    process.stdout.write(`${okLine}${where}.\n`);
    return;
  }
  for (const v of violations) process.stderr.write(`${formatViolation(v)}\n`);
  process.stderr.write(`\n${summaryLine}\n`);
  process.exit(1);
}

export async function runFileHook(argv, { usage, collect, okLine, summary }) {
  const args = argv.slice(2);
  const mode = args[0];
  const warn = args.includes("--warn");
  const files = await selectHookFiles(
    mode,
    args.filter((a) => a !== "--warn"),
    usage,
  );
  const perFile = await Promise.all(files.map((path) => collect(path, mode)));
  const violations = perFile.flat();
  if (warn && violations.length > 0) {
    for (const v of violations) process.stderr.write(`${formatViolation(v)}\n`);
    process.stderr.write(
      `\n⚠ ${summary(violations.length)} (advisory — not blocking this commit yet)\n`,
    );
    return;
  }
  emitHookReport(violations, {
    mode,
    okLine,
    summaryLine: summary(violations.length),
  });
}

export function isInvokedAsScript(importMetaUrl) {
  return (
    resolve(process.argv[1] ?? "") === resolve(new URL(importMetaUrl).pathname)
  );
}
