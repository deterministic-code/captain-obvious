// Shared slug->row lookups used across the entity modules. Each "require"
// helper throws a clear captain-obvious-style error when the referenced row is
// missing, so multi-table writes fail before touching the DB.

import type { Db } from "./open.js";
import type { RuleRow } from "./types.js";

function idBySlug(db: Db, table: string, slug: string): number | undefined {
  const row = db
    .prepare(`SELECT id FROM ${table} WHERE slug = ?`)
    .get(slug) as { id: number } | undefined;
  return row?.id;
}

export function requireLanguageId(db: Db, slug: string): number {
  const id = idBySlug(db, "languages", slug);
  if (id === undefined) throw new Error(`unknown language: ${slug}`);
  return id;
}

export function requireHookId(db: Db, slug: string): number {
  const id = idBySlug(db, "hooks", slug);
  if (id === undefined) throw new Error(`unknown hook: ${slug}`);
  return id;
}

export function requireActionTypeId(db: Db, slug: string): number {
  const id = idBySlug(db, "action_types", slug);
  if (id === undefined) throw new Error(`unknown action type: ${slug}`);
  return id;
}

export function requireEnvironmentId(db: Db, slug: string): number {
  const id = idBySlug(db, "environments", slug);
  if (id === undefined) throw new Error(`unknown environment: ${slug}`);
  return id;
}

export function requireRule(db: Db, slug: string): RuleRow {
  const row = db.prepare("SELECT * FROM rules WHERE slug = ?").get(slug) as
    | RuleRow
    | undefined;
  if (row === undefined) throw new Error(`unknown rule: ${slug}`);
  return row;
}
