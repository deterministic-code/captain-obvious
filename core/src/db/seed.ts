import { nameFor } from "../rules/languages.js";
import type { RulePlugin } from "../rules/plugin.js";
import type { Db } from "./open.js";
import { logEvent } from "./audit.js";
import { registerRule } from "./rules.js";

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
 * register each plugin — its row, language/category/stage links, and fixes.
 * Idempotent. Does not touch per-environment action bindings. Pass `only` to seed
 * a single rule by slug.
 */
export function seedRules(
  db: Db,
  rules: RulePlugin[],
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
    for (const r of selected) registerRule(db, r);
  });
  tx();

  logEvent("rules.seeded", `seeded ${selected.length} rule(s)`);

  return {
    seeded: selected.map((r) => r.meta.slug),
    languages: [...languages].sort(),
  };
}
