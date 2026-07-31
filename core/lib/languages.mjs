/**
 * Canonical language catalog — the single source of truth for "what language is
 * this file". Both sides of the compile boundary read it: the compiled server
 * (src/, typed via lib/languages.d.ts) and the uncompiled git hooks
 * (hooks/git/*.mjs, which import this file directly at pre-commit time). Add a
 * dialect here and every derived set below picks it up, so extension lists never
 * drift between the hooks and the registry again.
 *
 * `jscpd` maps an extension to its jscpd format slug; only the JS/TS family sets
 * it, because those are the only languages the bundled Node hooks police (Rust,
 * C# et al. have their own toolchains). Content-based detection — shebangs,
 * extension-less files like Dockerfile/Makefile, .h as C-vs-C++ — is a separate
 * layer that will live here as `detectWithContent`; `detect` is extension-only.
 */
import { extname } from "node:path";

export const LANGUAGES = [
  {
    slug: "typescript",
    name: "TypeScript",
    extensions: ["ts", "tsx"],
    jscpd: { ".ts": "typescript", ".tsx": "tsx" },
    isSupported: true,
  },
  {
    slug: "javascript",
    name: "JavaScript",
    extensions: ["js", "jsx", "mjs", "cjs"],
    jscpd: {
      ".js": "javascript",
      ".jsx": "jsx",
      ".mjs": "javascript",
      ".cjs": "javascript",
    },
    isSupported: true,
  },
  { slug: "csharp", name: "C#", extensions: ["cs"], isSupported: true },
  { slug: "python", name: "Python", extensions: ["py"], isSupported: false },
  { slug: "java", name: "Java", extensions: ["java"], isSupported: false },
  { slug: "go", name: "Go", extensions: ["go"], isSupported: false },
  { slug: "rust", name: "Rust", extensions: ["rs"], isSupported: false },
  { slug: "ruby", name: "Ruby", extensions: ["rb"], isSupported: false },
  { slug: "php", name: "PHP", extensions: ["php"], isSupported: false },
  { slug: "c", name: "C", extensions: ["c", "h"], isSupported: false },
  {
    slug: "cpp",
    name: "C++",
    extensions: ["cpp", "cc", "cxx", "hpp"],
    isSupported: false,
  },
  {
    slug: "kotlin",
    name: "Kotlin",
    extensions: ["kt", "kts"],
    isSupported: false,
  },
  { slug: "swift", name: "Swift", extensions: ["swift"], isSupported: false },
  {
    slug: "scala",
    name: "Scala",
    extensions: ["scala", "sc"],
    isSupported: false,
  },
  { slug: "dart", name: "Dart", extensions: ["dart"], isSupported: false },
  {
    slug: "elixir",
    name: "Elixir",
    extensions: ["ex", "exs"],
    isSupported: false,
  },
  {
    slug: "shell",
    name: "Shell",
    extensions: ["sh", "bash"],
    isSupported: false,
  },
  { slug: "sql", name: "SQL", extensions: ["sql"], isSupported: false },
];

const dotted = (ext) => `.${ext}`;

/** Slug of the language that claims a given dotted extension, indexed once. */
const BY_EXT = new Map(
  LANGUAGES.flatMap((l) => l.extensions.map((e) => [dotted(e), l])),
);

/**
 * The catalog entry for a path's extension, or null when no language claims it.
 * Extension-only — see the file header for the planned content-based layer.
 */
export function detect(path) {
  return BY_EXT.get(extname(path)) ?? null;
}

/** Extensions (dotted) the bundled Node lint hooks police: the JS/TS family. */
export const JS_TS_EXTS = new Set(
  LANGUAGES.filter((l) => l.jscpd).flatMap((l) => l.extensions.map(dotted)),
);

/** Dotted extension → jscpd format slug, for the duplication hooks. */
export const JSCPD_FORMAT_BY_EXT = Object.assign(
  {},
  ...LANGUAGES.map((l) => l.jscpd ?? {}),
);
