import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { LintRule, RuleMeta } from "./types.js";

/** Package root: two levels up from this module (src/rules or dist/rules). */
const pkgRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * Wrap a rule's metadata in the common LintRule surface. `run` delegates to the
 * existing hook implementation by dynamically importing hooks/git/<slug>.mjs and
 * calling its `main(argv)` — the same slug->path convention as bin/lint.mjs. The
 * computed import keeps this off the tsc rootDir and needs no .d.ts for the .mjs.
 */
export function defineRule(meta: RuleMeta): LintRule {
  return {
    meta,
    async run(argv: string[]): Promise<void> {
      const hookPath = resolve(pkgRoot, "hooks", "git", `${meta.slug}.mjs`);
      const mod = await import(pathToFileURL(hookPath).href);
      await mod.main(argv);
    },
  };
}
