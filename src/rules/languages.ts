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

/** Canonical language catalog. Extend as new dialects gain rules. */
export const LANGUAGES: ReadonlyArray<LanguageCatalogEntry> = [
  { slug: "typescript", name: "TypeScript", extensions: ["ts", "tsx"], isSupported: true },
  { slug: "javascript", name: "JavaScript", extensions: ["js", "jsx", "mjs", "cjs"], isSupported: true },
  { slug: "csharp", name: "C#", extensions: ["cs"], isSupported: true },
  { slug: "python", name: "Python", extensions: ["py"], isSupported: false },
  { slug: "java", name: "Java", extensions: ["java"], isSupported: false },
  { slug: "go", name: "Go", extensions: ["go"], isSupported: false },
  { slug: "rust", name: "Rust", extensions: ["rs"], isSupported: false },
  { slug: "ruby", name: "Ruby", extensions: ["rb"], isSupported: false },
  { slug: "php", name: "PHP", extensions: ["php"], isSupported: false },
  { slug: "c", name: "C", extensions: ["c", "h"], isSupported: false },
  { slug: "cpp", name: "C++", extensions: ["cpp", "cc", "cxx", "hpp"], isSupported: false },
  { slug: "kotlin", name: "Kotlin", extensions: ["kt", "kts"], isSupported: false },
  { slug: "swift", name: "Swift", extensions: ["swift"], isSupported: false },
  { slug: "scala", name: "Scala", extensions: ["scala", "sc"], isSupported: false },
  { slug: "dart", name: "Dart", extensions: ["dart"], isSupported: false },
  { slug: "elixir", name: "Elixir", extensions: ["ex", "exs"], isSupported: false },
  { slug: "shell", name: "Shell", extensions: ["sh", "bash"], isSupported: false },
  { slug: "sql", name: "SQL", extensions: ["sql"], isSupported: false },
];

/** Display name for a language slug, falling back to the slug itself. */
export function nameFor(slug: string): string {
  return LANGUAGES.find((l) => l.slug === slug)?.name ?? slug;
}
