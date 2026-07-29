/**
 * Thin bridge from the git hook (plain ESM) to the compiled registry layer:
 * loads the default project's protected globs and the matcher. Kept out of
 * coverage (imports compiled dist) — the logic it forwards to lives in
 * src/rules/protectedPaths.ts, tested there.
 */
export async function loadProtected() {
  const { readProtectedGlobs, matchProtected } = await import(
    "../../dist/rules/protectedPaths.js"
  );
  return { globs: readProtectedGlobs(), match: matchProtected };
}
