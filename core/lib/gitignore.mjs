import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * The local-mode DB directory (`<repoRoot>/.captain-obvious/`, per db/location.ts),
 * as the trailing-slash gitignore pattern that excludes the whole dir — registry DB,
 * audit DB, and any WAL/SHM sidecars. Global mode keeps its DBs outside the repo, so
 * there is nothing to ignore there.
 */
export const DB_DIR_IGNORE = ".captain-obvious/";

const MARKER = "# captain-obvious — local registry + audit DBs";

// Pattern spellings that already exclude the DB directory, so we never double-add.
const COVERS = new Set([
  ".captain-obvious",
  ".captain-obvious/",
  "/.captain-obvious",
  "/.captain-obvious/",
]);

function alreadyIgnored(text) {
  return text.split("\n").some((line) => {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) return false;
    return COVERS.has(trimmed);
  });
}

// Append the managed block, separated from existing content by one blank line.
function withBlock(text) {
  const body = text.replace(/\n+$/, "");
  const prefix = body === "" ? "" : `${body}\n\n`;
  return `${prefix}${MARKER}\n${DB_DIR_IGNORE}\n`;
}

/**
 * Ensure `<target>/.gitignore` excludes the local DB directory. Idempotent: if any
 * spelling that already covers `.captain-obvious/` is present, it is left untouched;
 * otherwise the managed block is appended (creating the file if absent). `apply:
 * false` computes the outcome without writing (for a dry-run/preview). Returns the
 * path, whether the file existed, whether it changed, and a `reason`
 * (`present` | `updated` | `created`).
 */
export async function ensureDbIgnored(target, { apply = true } = {}) {
  const path = join(target, ".gitignore");
  const raw = await readFile(path, "utf8").catch((err) => {
    if (err.code === "ENOENT") return null;
    throw err;
  });
  const existed = raw !== null;
  const text = raw ?? "";
  if (alreadyIgnored(text)) {
    return { path, existed, changed: false, reason: "present" };
  }
  if (apply) await writeFile(path, withBlock(text), "utf8");
  return {
    path,
    existed,
    changed: true,
    reason: existed ? "updated" : "created",
  };
}
