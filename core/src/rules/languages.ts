import { LANGUAGES as DIALECTS } from "../../lib/languages.mjs";

/** One language in the canonical catalog seeded into the registry. */
export interface LanguageCatalogEntry {
  slug: string;
  name: string;
  /** File extensions without the dot, e.g. ["ts", "tsx"]. */
  extensions: string[];
  /**
   * True when the bundled rule set can police this language today. The broader
   * catalog exists so the panel can surface not-yet-supported languages, so this
   * flag is deliberately decoupled from the `Language` union — a language may be
   * marked supported here before any rule can target it in TypeScript.
   */
  isSupported: boolean;
}

/**
 * Canonical language catalog, projected from the shared source of truth
 * (lib/languages.mjs) that the git hooks also read. Add dialects there, not here.
 */
export const LANGUAGES: ReadonlyArray<LanguageCatalogEntry> = DIALECTS.map(
  (d) => ({
    slug: d.slug,
    name: d.name,
    extensions: d.extensions,
    isSupported: d.isSupported,
  }),
);

/** Display name for a language slug, falling back to the slug itself. */
export function nameFor(slug: string): string {
  return LANGUAGES.find((l) => l.slug === slug)?.name ?? slug;
}
