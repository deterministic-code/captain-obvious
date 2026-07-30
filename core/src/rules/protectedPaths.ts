import picomatch from "picomatch";
import { openDb, resolveDbPath } from "../db/open.js";
import { getDefaultProjectProtected } from "../db/projects.js";

/**
 * True when `relPath` (repo-relative) matches any protected glob. `dot: true` so
 * dotfile roots like `.github/**` match. An empty glob set protects nothing.
 */
export function matchProtected(relPath: string, globs: string[]): boolean {
  if (globs.length === 0) return false;
  return picomatch(globs, { dot: true })(relPath);
}

/**
 * The default project's protected globs, read from the registry DB. Opens the
 * default DB (honoring CAPTAIN_OBVIOUS_DB) so the git hook can call it from its
 * own process, and always closes.
 */
export function readProtectedGlobs(): string[] {
  const db = openDb(resolveDbPath());
  try {
    return getDefaultProjectProtected(db);
  } finally {
    db.close();
  }
}
