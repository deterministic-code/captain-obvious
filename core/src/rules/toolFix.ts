/**
 * Which tool-stage fixes to run on a just-written file. The Claude Code
 * PostToolUse hook (hooks/claude/tool-fix.mjs) calls this after a Write/Edit and
 * runs each returned rule's deterministic fix over the file (e.g. Prettier
 * reformats it). The tool stage's *guard* rules stay on PreToolUse (claudeGuard);
 * this is its *fix* half.
 */
import { relative } from "node:path";
import { detect } from "../../lib/languages.mjs";
import { languagesBySlug } from "../db/languages.js";
import type { Db } from "../db/open.js";
import { selectDispatch } from "./dispatch.js";

/**
 * The enabled, tool-staged rules whose deterministic fix targets `filePath`: a
 * fix binding (`d.fix`, already resolved by selectDispatch) plus one of the
 * rule's languages matching the file. A file in no catalog language matches
 * nothing. A fix-bound rule always carries languages; a malformed one throws
 * (the caller fails open) rather than silently skipping.
 */
export function selectToolFixes(db: Db, filePath: string): string[] {
  const fileLang = detect(filePath)?.slug ?? null;
  if (fileLang === null) return [];
  const langs = languagesBySlug(db);
  return selectDispatch(db, "tool")
    .filter((d) => d.fix !== null)
    .filter((d) => langs.get(d.slug)!.includes(fileLang))
    .map((d) => d.slug);
}

/**
 * The `systemMessage` line the PostToolUse hook shows the user after a write,
 * naming the file and which tool-fixes actually rewrote it — or null when none
 * did, so an already-formatted edit stays silent. `filePath` is displayed
 * relative to `cwd` (the repo root the hook resolved).
 */
export function formatToolFixNotice(
  filePath: string,
  changedBy: string[],
  cwd: string,
): string | null {
  if (changedBy.length === 0) return null;
  const rel = relative(cwd, filePath) || filePath;
  return `captain-obvious: reformatted ${rel} (${changedBy.join(", ")})`;
}
