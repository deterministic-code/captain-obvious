#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import {
  emitFound,
  emitJson,
  formatViolation,
  isExcluded,
  isInvokedAsScript,
  jsonMode,
  listAllFiles,
  listStagedFiles,
  stripStringsAndComments,
} from "@deterministic-code/co-rule-kit/lint-shared";
import { JS_TS_EXTS as SUPPORTED_EXTS } from "@deterministic-code/captain-obvious/languages";

export { SUPPORTED_EXTS };

export const DEVOPS_ALLOWLIST = [
  "scripts/hooks/install-git-hooks.mjs",
  "scripts/install-rust-toolchain.mjs",
  "scripts/install-skills.mjs",
  "scripts/postinstall-node-pty.mjs",
  "scripts/deploy-droplet.mjs",
  "scripts/rollback-droplet.mjs",
  "scripts/docker-deploy.mjs",
  "scripts/docker-push.mjs",
  "scripts/build-skills-dist.mjs",
  "scripts/publish-deterministic-crate.mjs",
  "scripts/profile-tests.mjs",
  "scripts/diagnose-generate.mjs",
  "scripts/diagnose-samples.mjs",
  "scripts/diagnose-samples-parallel.mjs",
  "scripts/run-tier-with-container.mjs",
  "scripts/verify-migrate-runner-csharp.mjs",
  "backend/scripts/migrate.mjs",
];

export function isDevopsAllowlisted(path) {
  const normalized = path.replace(/^\.?\/+/, "");
  return DEVOPS_ALLOWLIST.some(
    (p) => normalized === p || normalized.endsWith(`/${p}`),
  );
}

export function isLintable(path) {
  if (isExcluded(path)) return false;
  if (isDevopsAllowlisted(path)) return false;
  return SUPPORTED_EXTS.has(extname(path));
}

const FORBIDDEN_SYNC_APIS = [
  "readFileSync",
  "writeFileSync",
  "appendFileSync",
  "readdirSync",
  "statSync",
  "lstatSync",
  "fstatSync",
  "mkdirSync",
  "rmSync",
  "rmdirSync",
  "unlinkSync",
  "copyFileSync",
  "linkSync",
  "symlinkSync",
  "realpathSync",
  "accessSync",
  "chmodSync",
  "chownSync",
  "lchmodSync",
  "lchownSync",
  "fchmodSync",
  "fchownSync",
  "renameSync",
  "truncateSync",
  "ftruncateSync",
  "utimesSync",
  "futimesSync",
  "openSync",
  "closeSync",
  "readSync",
  "writeSync",
  "fsyncSync",
  "fdatasyncSync",
  "readlinkSync",
  "mkdtempSync",
  "opendirSync",
  "watchFileSync",
  "existsSync",
  "globSync",
  "execSync",
  "execFileSync",
  "spawnSync",
  "forkSync",
];

const SYNC_RE = new RegExp(`\\b(${FORBIDDEN_SYNC_APIS.join("|")})\\s*\\(`, "g");

export function findViolations(src) {
  const stripped = stripStringsAndComments(src);
  const violations = [];
  let m;
  SYNC_RE.lastIndex = 0;
  while ((m = SYNC_RE.exec(stripped)) !== null) {
    const name = m[1];
    const idx = m.index;
    const line = src.slice(0, idx).split("\n").length;
    const col = idx - src.lastIndexOf("\n", idx - 1);
    violations.push({
      line,
      col,
      kind: "sync call",
      detail: `${name}() blocks the event loop. Use the async equivalent (node:fs/promises, async child_process via promisify, etc.).`,
    });
  }
  return violations;
}

export async function lintFile(path) {
  let src;
  try {
    src = await readFile(path, "utf8");
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
  return findViolations(src).map((v) => ({ ...v, path }));
}

export { formatViolation };

export async function main(argv) {
  const args = argv.slice(2);
  const mode = args[0];
  let files;
  if (mode === "--staged") {
    files = await listStagedFiles();
  } else if (mode === "--all") {
    files = await listAllFiles();
  } else if (mode === "--files") {
    files = args.slice(1);
  } else {
    process.stderr.write(
      "Usage:\n  node scripts/hooks/lint-sync-calls.mjs --staged\n  node scripts/hooks/lint-sync-calls.mjs --all\n  node scripts/hooks/lint-sync-calls.mjs --files <path> [...]\n",
    );
    process.exit(2);
  }
  const targets = files.filter(isLintable);
  const violations = (await Promise.all(targets.map(lintFile))).flat();
  if (jsonMode()) return emitJson(violations);
  emitFound(violations.length);
  if (violations.length === 0) {
    if (mode === "--staged")
      process.stdout.write("lint-sync-calls: no sync calls in staged diff.\n");
    else if (mode === "--all")
      process.stdout.write("lint-sync-calls: no sync calls in repo.\n");
    return;
  }
  for (const v of violations) process.stderr.write(`${formatViolation(v)}\n`);
  process.stderr.write(
    `\nlint-sync-calls: ${violations.length} violation(s). Rule: sync I/O blocks the event loop. Use node:fs/promises or promisify-wrapped child_process. No exceptions.\n`,
  );
  process.exit(1);
}

/* v8 ignore next 6 */
if (isInvokedAsScript(import.meta.url)) {
  main(process.argv).catch((err) => {
    process.stderr.write(`lint-sync-calls: ${err.message ?? err}\n`);
    process.exit(2);
  });
}
