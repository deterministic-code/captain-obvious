#!/usr/bin/env node
import { execFile } from "node:child_process";
import { relative, resolve } from "node:path";
import { promisify } from "node:util";
import {
  emitJson,
  formatViolation,
  isInvokedAsScript,
  jsonMode,
  repoRootOf,
  resolveToolBin,
  sanitizedGitEnv,
} from "./lint-shared.mjs";

const execFileAsync = promisify(execFile);

const KNIP_EXCLUDE = "dependencies,unlisted,binaries,unresolved";

export function knipIssuesToViolations(issues) {
  const violations = [];
  for (const issue of issues) {
    const file = issue.file;
    for (const f of issue.files ?? []) {
      violations.push({
        path: f.name ?? file,
        line: 1,
        col: 1,
        kind: "unused file",
        detail:
          "no other module imports this file. Delete it, or add its entrypoint to knip.json if it is reached dynamically.",
      });
    }
    for (const kind of ["exports", "types", "enumMembers"]) {
      for (const ex of flattenExportGroup(issue[kind])) {
        violations.push({
          path: file,
          line: ex.line ?? 1,
          col: ex.col ?? 1,
          kind: `unused ${singular(kind)} \`${ex.name}\``,
          detail:
            "nothing imports this export. Remove it, or if it is consumed dynamically (string-keyed dispatch), add the referencing entry to knip.json.",
        });
      }
    }
  }
  return violations;
}

function flattenExportGroup(group) {
  if (!group) return [];
  if (Array.isArray(group)) return group;
  return Object.values(group).flat();
}

function singular(kind) {
  return { exports: "export", types: "type", enumMembers: "enum member" }[kind];
}

async function runKnip(repoRoot) {
  const bin = await resolveToolBin("knip");
  const { stdout } = await execFileAsync(
    process.execPath,
    [bin, "--reporter", "json", "--exclude", KNIP_EXCLUDE, "--no-exit-code"],
    {
      cwd: repoRoot,
      encoding: "utf8",
      env: sanitizedGitEnv(),
      maxBuffer: 64 * 1024 * 1024,
    },
  );
  const parsed = JSON.parse(stdout);
  if (!Array.isArray(parsed.issues)) {
    throw new Error("invariant: knip report has no `issues` array");
  }
  return parsed.issues;
}

function printReport(violations, scopeLabel, blocking) {
  if (violations.length === 0) {
    process.stdout.write(
      `lint-dead-code: no dead code found in ${scopeLabel}.\n`,
    );
    return;
  }
  for (const v of violations) process.stdout.write(`${formatViolation(v)}\n`);
  const suffix = blocking ? "" : " (report-only)";
  process.stdout.write(
    `\nlint-dead-code: ${violations.length} dead-code finding(s) in ${scopeLabel}${suffix}. Whitelist dynamic entrypoints in knip.json; delete the rest.\n`,
  );
}

export async function main(argv) {
  const mode = argv[2];
  const repoRoot = await repoRootOf(process.cwd());

  if (mode === "--all") {
    const violations = knipIssuesToViolations(await runKnip(repoRoot));
    if (jsonMode()) return emitJson(violations);
    printReport(violations, "the repo", true);
    if (violations.length > 0) process.exitCode = 1;
    return;
  }

  if (mode === "--files") {
    const targets = new Set(
      argv.slice(3).map((f) => relative(repoRoot, resolve(f))),
    );
    if (targets.size === 0) {
      if (jsonMode()) return emitJson([]);
      process.stdout.write("lint-dead-code: no files given.\n");
      return;
    }
    const violations = knipIssuesToViolations(await runKnip(repoRoot)).filter(
      (v) => targets.has(v.path),
    );
    if (jsonMode()) return emitJson(violations);
    printReport(violations, "the given files", false);
    return;
  }

  process.stderr.write(
    "Usage:\n  node scripts/hooks/lint-dead-code.mjs --all\n  node scripts/hooks/lint-dead-code.mjs --files <path> [...]\n",
  );
  process.exit(2);
}

/* v8 ignore next 6 */
if (isInvokedAsScript(import.meta.url)) {
  main(process.argv).catch((err) => {
    process.stderr.write(`lint-dead-code: ${err.message ?? err}\n`);
    process.exit(2);
  });
}
