// Config bridge for checks: returns a rule's effective config (its global config
// overlaid by the default project's override) so a panel edit reaches the running
// check. Imports the core by package name (co-rule-kit depends on the core
// package), so it resolves both in the monorepo and standalone. Excluded from
// coverage — the merge logic it forwards to lives in the core's src/rules/config.ts.

export async function ruleConfig(slug) {
  const { openDb, resolveDbPath } = await import(
    "@deterministic-code/captain-obvious/runtime/db"
  );
  const { ruleConfigFromDb } = await import(
    "@deterministic-code/captain-obvious/runtime/config"
  );
  const db = openDb(resolveDbPath());
  try {
    return ruleConfigFromDb(db, slug);
  } finally {
    db.close();
  }
}
