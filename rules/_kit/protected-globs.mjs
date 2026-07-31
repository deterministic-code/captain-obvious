/**
 * Thin bridge from the check (plain ESM) to the core's compiled registry layer,
 * imported by the core package name (co-rule-kit depends on the core package), so
 * it resolves both in the monorepo and standalone. Kept out of coverage — the
 * logic it forwards to lives in the core's src/rules/protectedPaths.ts, tested there.
 */
export async function loadProtected() {
  const { readProtectedGlobs, matchProtected } =
    await import("@deterministic-code/captain-obvious/runtime/protected-paths");
  return { globs: readProtectedGlobs(), match: matchProtected };
}
