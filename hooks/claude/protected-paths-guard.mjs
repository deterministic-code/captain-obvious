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

/**
 * PreToolUse guard entry: read the hook event from stdin, and if it edits a
 * protected path (per the registry's default project) print the deny decision.
 * Fail-open on anything unexpected — a guard must never break a benign edit.
 * I/O shim (reads stdin, spawns git, opens the DB); the decision lives in
 * src/rules/claudeGuard.ts, tested there.
 */
export async function runClaudeGuard() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const inputJson = Buffer.concat(chunks).toString("utf8");
  if (!inputJson.trim()) return;
  const input = JSON.parse(inputJson);
  const filePath = input?.tool_input?.file_path;
  if (!filePath) return;
  const root = await repoRootOf(input.cwd || dirname(filePath));
  if (!root) return;
  const { guardDecision, formatDeny } = await import(
    "../../dist/rules/claudeGuard.js"
  );
  const { openDb, resolveDbPath } = await import("../../dist/db/open.js");
  const db = openDb(resolveDbPath());
  let decision;
  try {
    decision = guardDecision(inputJson, root, db);
  } finally {
    db.close();
  }
  if (decision.deny) process.stdout.write(`${formatDeny(decision.reason)}\n`);
}

runClaudeGuard().catch((err) => {
  process.stderr.write(`protected-paths-guard: ${err.message ?? err}\n`);
});
