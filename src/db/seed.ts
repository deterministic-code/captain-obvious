import { nameFor } from "../rules/languages.js";
import type { LintRule } from "../rules/types.js";
import type { Db } from "./open.js";
import { upsertRule } from "./rules.js";

export interface SeedOpts {
  /** Seed only the rule with this slug. */
  only?: string;
}

export interface SeedSummary {
  seeded: string[];
  languages: string[];
}

/**
 * Seed the registry from the rule set: auto-seed every referenced language, then
 * upsert each rule (and its language links). Idempotent. Does not touch action
 * bindings. Pass `only` to seed a single rule by slug.
 */
export function seedRules(
  db: Db,
  rules: LintRule[],
  opts: SeedOpts = {},
): SeedSummary {
  const selected = opts.only
    ? rules.filter((r) => r.meta.slug === opts.only)
    : rules;
  if (opts.only && selected.length === 0) {
    throw new Error(`unknown rule: ${opts.only}`);
  }

  const languages = new Set<string>();
  for (const r of selected) for (const l of r.meta.languages) languages.add(l);

  const ensureLang = db.prepare(
    "INSERT OR IGNORE INTO languages (slug, name) VALUES (?, ?)",
  );
  const tx = db.transaction(() => {
    for (const slug of languages) ensureLang.run(slug, nameFor(slug));
    for (const r of selected) upsertRule(db, r.meta);
  });
  tx();

  return {
    seeded: selected.map((r) => r.meta.slug),
    languages: [...languages].sort(),
  };
}
