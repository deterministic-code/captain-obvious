// Minimal flag parser, ported from bin/install.mjs's parseArgs idiom.
// Turns `--flag value` pairs and bare `--flag` booleans into a typed map,
// with the first non-flag token exposed as the positional `_`.

export interface ParsedArgs {
  /** First positional argument (e.g. the rule slug for configure-rule). */
  _: string | undefined;
  /** Flags with an explicit value: `--slug foo` -> { slug: "foo" }. */
  values: Map<string, string>;
  /** Bare boolean flags: `--enable` -> Set{ "enable" }. */
  flags: Set<string>;
}

/** Flags that never take a value (bare booleans). */
const BOOLEAN_FLAGS = new Set(["enable", "disable", "add"]);

export function parseArgs(argv: string[]): ParsedArgs {
  const values = new Map<string, string>();
  const flags = new Set<string>();
  let positional: string | undefined;

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token.startsWith("--")) {
      const key = token.slice(2);
      if (BOOLEAN_FLAGS.has(key)) {
        flags.add(key);
      } else {
        const next = argv[i + 1];
        if (next === undefined || next.startsWith("--")) {
          throw new Error(`missing value for --${key}`);
        }
        values.set(key, next);
        i += 1;
      }
    } else if (positional === undefined) {
      positional = token;
    }
  }

  return { _: positional, values, flags };
}

/** Split a comma-separated flag value into trimmed, non-empty parts. */
export function csv(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}
