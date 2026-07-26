import type { Language } from "./types.js";

/** Canonical language catalog. Extend as new dialects gain rules. */
export const LANGUAGES: ReadonlyArray<{ slug: Language; name: string }> = [
  { slug: "typescript", name: "TypeScript" },
  { slug: "javascript", name: "JavaScript" },
];

/** Display name for a language slug, falling back to the slug itself. */
export function nameFor(slug: string): string {
  return LANGUAGES.find((l) => l.slug === slug)?.name ?? slug;
}
