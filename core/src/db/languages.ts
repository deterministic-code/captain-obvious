import { logEvent } from "./audit.js";
import type { Db } from "./open.js";
import type { AddLanguageOpts, LanguageRow } from "./types.js";

/**
 * Insert a programming language. `extensions` is stored as a JSON array string.
 * Throws on a duplicate slug (UNIQUE constraint).
 */
export function addLanguage(db: Db, opts: AddLanguageOpts): LanguageRow {
  const { slug, name, extensions } = opts;
  if (!slug || !name)
    throw new Error("add-language requires --slug and --name");

  const extensionsJson =
    extensions && extensions.length > 0 ? JSON.stringify(extensions) : null;

  try {
    const info = db
      .prepare(
        "INSERT INTO languages (slug, name, extensions) VALUES (?, ?, ?)",
      )
      .run(slug, name, extensionsJson);
    logEvent("language.added", `added language ${slug}`);
    return db
      .prepare("SELECT * FROM languages WHERE id = ?")
      .get(info.lastInsertRowid) as LanguageRow;
  } catch (err) {
    if (isUniqueViolation(err))
      throw new Error(`language already exists: ${slug}`);
    throw err;
  }
}

/**
 * Every rule's language slugs keyed by rule slug, so a caller (e.g. the Activity
 * feed) can annotate a run with the languages its rule targets without a per-row
 * query. A rule with no languages simply has no entry.
 */
export function languagesBySlug(db: Db): Map<string, string[]> {
  const rows = db
    .prepare(
      `SELECT r.slug AS slug, l.slug AS lang
         FROM rule_languages rl
         JOIN languages l ON l.id = rl.language_id
         JOIN rules     r ON r.id = rl.rule_id
        ORDER BY l.slug`,
    )
    .all() as { slug: string; lang: string }[];
  const bySlug = new Map<string, string[]>();
  for (const { slug, lang } of rows) {
    const list = bySlug.get(slug) ?? [];
    if (list.length === 0) bySlug.set(slug, list);
    list.push(lang);
  }
  return bySlug;
}

export function isUniqueViolation(err: unknown): boolean {
  return (
    err instanceof Error &&
    "code" in err &&
    (err as { code?: string }).code === "SQLITE_CONSTRAINT_UNIQUE"
  );
}
