/**
 * Stop guard entry: run the enabled stop-stage guard rule (gov-merge-before-stop)
 * through the single rule runner and block the session-end when it reports
 * unmerged work. I/O shim only — the git/gh logic lives in the rule's check.mjs;
 * here we spawn it via the runner (so it logs a run.start/run.end + hook_run) and
 * translate a non-zero exit into a Stop `block`. Fails open but loud.
 */
async function run() {
  // The Stop event's stdin is session info; the guard acts on the repo state.
  for await (const _chunk of process.stdin) void _chunk;
  const cwd = process.env.CLAUDE_PROJECT_DIR || process.cwd();

  const { openDb, resolveDbPath } = await import("../../dist/db/open.js");
  const { selectDispatch } = await import("../../dist/rules/dispatch.js");
  const db = openDb(resolveDbPath());
  const staged = selectDispatch(db, "stop").map((d) => d.slug);
  db.close();
  if (!staged.includes("gov-merge-before-stop")) return;

  const { openAuditDb, resolveAuditDbPath } = await import(
    "../../dist/db/audit.js"
  );
  const { dispatchRule } = await import("../../dist/rules/runner.js");
  const auditDb = openAuditDb(resolveAuditDbPath());
  let outcome;
  try {
    outcome = await dispatchRule(auditDb, {
      slug: "gov-merge-before-stop",
      stage: "stop",
      cwd,
      args: [],
      mode: "json",
    });
  } finally {
    auditDb.close();
  }
  if (outcome.code !== 0 && outcome.stderr) {
    process.stdout.write(
      `${JSON.stringify({ decision: "block", reason: outcome.stderr })}\n`,
    );
  }
}

run().catch((err) => {
  const systemMessage = `captain-obvious stop-guard failed — ${err?.message ?? err}`;
  process.stdout.write(`${JSON.stringify({ systemMessage })}\n`);
});
