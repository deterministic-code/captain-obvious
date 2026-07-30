import type { RuleDependency, RulePlugin } from "./plugin.js";

export interface DepStatus {
  slug: string;
  dep: RuleDependency;
  present: boolean;
}

/**
 * Check every rule's declared external dependencies with `probe` (which reports
 * whether a tool/package is available). Pure — the actual probing (require.resolve
 * for npm, PATH lookup for bins) lives in the CLI/install shims so this stays
 * platform-agnostic and fully testable. Returns one status per declared dep.
 */
export function verifyDependencies(
  plugins: RulePlugin[],
  probe: (dep: RuleDependency) => boolean,
): DepStatus[] {
  const out: DepStatus[] = [];
  for (const p of plugins) {
    for (const dep of p.dependencies ?? []) {
      out.push({ slug: p.meta.slug, dep, present: probe(dep) });
    }
  }
  return out;
}

/** The missing, non-optional dependencies — what a warn-only check should report. */
export function missingRequired(statuses: DepStatus[]): DepStatus[] {
  return statuses.filter((s) => !s.present && !s.dep.optional);
}
