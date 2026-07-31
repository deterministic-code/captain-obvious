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

export function isUniqueViolation(err: unknown): boolean {
  return (
    err instanceof Error &&
    "code" in err &&
    (err as { code?: string }).code === "SQLITE_CONSTRAINT_UNIQUE"
  );
}
