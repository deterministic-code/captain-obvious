import { readFile, rm, writeFile } from "node:fs/promises";
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

// Drop the managed block (the MARKER line + the DB pattern line right after it) and
// the one blank separator we inserted before it. Returns the text unchanged when the
// marker isn't there, so we only ever remove what we wrote — a hand-authored
// `.captain-obvious/` line with no marker is left alone.
function stripBlock(raw) {
  const lines = raw.split("\n");
  const idx = lines.findIndex((line) => line.trim() === MARKER);
  if (idx === -1) return raw;
  const end =
    idx + 1 < lines.length && COVERS.has(lines[idx + 1].trim())
      ? idx + 2
      : idx + 1;
  const start = idx > 0 && lines[idx - 1].trim() === "" ? idx - 1 : idx;
  lines.splice(start, end - start);
  return lines.join("\n");
}

/**
 * Reverse {@link ensureDbIgnored}: remove the managed block from `<target>/.gitignore`,
 * deleting the file outright if that leaves it empty (i.e. we created it just for this).
 * Idempotent and conservative — a marker-less `.captain-obvious/` line the user wrote by
 * hand is left in place. `apply: false` previews without writing. Returns the path,
 * whether it changed, and a `reason` (`no-file` | `not-present` | `removed`).
 */
export async function removeDbIgnore(target, { apply = true } = {}) {
  const path = join(target, ".gitignore");
  const raw = await readFile(path, "utf8").catch((err) => {
    if (err.code === "ENOENT") return null;
    throw err;
  });
  if (raw === null) return { path, changed: false, reason: "no-file" };
  const next = stripBlock(raw);
  if (next === raw) return { path, changed: false, reason: "not-present" };
  const emptied = next.trim() === "";
  if (apply) {
    if (emptied) await rm(path);
    else await writeFile(path, next, "utf8");
  }
  return { path, changed: true, reason: "removed", emptied };
}
