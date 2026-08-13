/**
 * PreToolUse guard entry: run every enabled tool-stage guard rule (protected
 * paths, no-edit-on-main) through the single rule runner and, if any denies, emit
 * the PreToolUse deny. I/O shim only — reads stdin, resolves the repo root, opens
 * the DBs; the decisions live in src/rules/claudeGuard.ts (runToolGuards), tested
 * there. Fails open (a guard must never crash a benign edit) but loud.
 */
import { execFile } from "node:child_process";
import { dirname } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

async function repoRootOf(cwd) {
  return execFileAsync("git", ["rev-parse", "--show-toplevel"], {
    cwd,
    encoding: "utf8",
  }).then(
    ({ stdout }) => stdout.trim(),
    () => null,
  );
}

async function run() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const inputJson = Buffer.concat(chunks).toString("utf8");
  if (!inputJson.trim()) return;
  const input = JSON.parse(inputJson);
  // A file edit is anchored at the file's repo; a Bash command at its own cwd.
  const filePath = input?.tool_input?.file_path;
  const anchor = filePath ? dirname(filePath) : input?.cwd || process.cwd();
  const root = await repoRootOf(anchor);
  if (!root) return;

  const { runToolGuards, formatGuardOutput } = await import(
    "../../dist/rules/claudeGuard.js"
  );
  const { openDb, resolveDbPath } = await import("../../dist/db/open.js");
  const { openAuditDb, resolveAuditDbPath } = await import(
    "../../dist/db/audit.js"
  );
  const db = openDb(resolveDbPath());
  const auditDb = openAuditDb(resolveAuditDbPath());
  let decision;
  try {
    decision = await runToolGuards(inputJson, root, db, auditDb);
  } finally {
    db.close();
    auditDb.close();
  }
  const output = formatGuardOutput(decision);
  if (output) process.stdout.write(`${output}\n`);
}

run().catch((err) => {
  const systemMessage = `captain-obvious pre-tool-guard failed — ${err?.message ?? err}`;
  process.stdout.write(`${JSON.stringify({ systemMessage })}\n`);
});
