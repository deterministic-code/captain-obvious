/**
 * PostToolUse I/O shim: after Claude writes a file, run every enabled tool-stage
 * fix that targets it (e.g. Prettier --write) and record each to Activity, the
 * same path as the panel Fix button. stdin is the hook event JSON. The decision
 * (which rules) lives in src/rules/toolFix.ts; this only wires stdin + the DBs +
 * the fix runner. Fails open — a formatting hook must never break a benign edit.
 */
async function run() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const inputJson = Buffer.concat(chunks).toString("utf8");
  if (!inputJson.trim()) return;
  const filePath = JSON.parse(inputJson)?.tool_input?.file_path;
  if (!filePath) return;

  const { openDb, resolveDbPath } = await import("../../dist/db/open.js");
  const { selectToolFixes } = await import("../../dist/rules/toolFix.js");
  const db = openDb(resolveDbPath());
  const slugs = selectToolFixes(db, filePath);
  if (slugs.length === 0) {
    db.close();
    return;
  }

  const { openAuditDb, resolveAuditDbPath, useAuditLog } =
    await import("../../dist/db/audit.js");
  const { fixRule } = await import("../../dist/server/fix.js");
  const auditDb = openAuditDb(resolveAuditDbPath());
  useAuditLog(auditDb);
  try {
    for (const slug of slugs) {
      await fixRule(db, auditDb, { slug, path: filePath });
    }
  } finally {
    db.close();
    auditDb.close();
  }
}

run().catch((err) => {
  process.stderr.write(`tool-fix: ${err.message ?? err}\n`);
});
