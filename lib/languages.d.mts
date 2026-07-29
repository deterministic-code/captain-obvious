/** One dialect in the canonical catalog (lib/languages.mjs). */
export interface LanguageDialect {
  slug: string;
  name: string;
  /** Extensions without the dot, e.g. ["ts", "tsx"]. */
  extensions: string[];
  /** Dotted extension → jscpd format slug; only the JS/TS family sets it. */
  jscpd?: Record<string, string>;
  isSupported: boolean;
}

export const LANGUAGES: ReadonlyArray<LanguageDialect>;
export function detect(path: string): LanguageDialect | null;
export const JS_TS_EXTS: ReadonlySet<string>;
export const JSCPD_FORMAT_BY_EXT: Record<string, string>;
