/**
 * The "Analyze project" backend: walk the target tree, classify every file by
 * language via the shared catalog (lib/languages.mjs), and record the scan in the
 * audit log. Read-only — it reports what languages are present and logs that a
 * scan happened; it does not touch the registry. The panel uses the recorded
 * event to decide whether to prompt the user to analyze before configuring rules.
 */
import { readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { detect } from "../../lib/languages.mjs";
import { latestEvent, logEvent } from "../db/audit.js";
import { HIDDEN_DIRS } from "./run.js";

export interface LanguageTally {
  slug: string;
  name: string;
  files: number;
}

export interface AnalyzeResult {
  root: string;
  /** Files a language claimed. */
  totalFiles: number;
  /** Files no catalog language claimed. */
  otherFiles: number;
  /** Detected languages, most files first. */
  languages: LanguageTally[];
}

async function walk(dir: string, onFile: (path: string) => void): Promise<void> {
  const dirents = await readdir(dir, { withFileTypes: true });
  for (const d of dirents) {
    if (d.isDirectory()) {
      if (d.name.startsWith(".") || HIDDEN_DIRS.has(d.name)) continue;
      await walk(join(dir, d.name), onFile);
    } else if (d.isFile()) {
      onFile(join(dir, d.name));
    }
  }
}

function summarize(result: AnalyzeResult): string {
  if (result.languages.length === 0) {
    return `analyzed ${result.root}: no recognized source files`;
  }
  const parts = result.languages.map((l) => `${l.name} ${l.files}`);
  return `analyzed ${result.root}: ${parts.join(", ")} (${result.otherFiles} other)`;
}

/** POST /api/analyze — scan `rawPath` (or cwd), tally languages, and log the scan. */
export async function analyzeProject(rawPath?: string): Promise<AnalyzeResult> {
  const root = rawPath?.trim() ? resolve(rawPath.trim()) : process.cwd();
  const tally = new Map<string, LanguageTally>();
  let totalFiles = 0;
  let otherFiles = 0;
  await walk(root, (filePath) => {
    const lang = detect(filePath);
    if (!lang) {
      otherFiles++;
      return;
    }
    totalFiles++;
    const entry = tally.get(lang.slug) ?? {
      slug: lang.slug,
      name: lang.name,
      files: 0,
    };
    entry.files++;
    tally.set(lang.slug, entry);
  });
  const languages = [...tally.values()].sort(
    (a, b) => b.files - a.files || a.slug.localeCompare(b.slug),
  );
  const result: AnalyzeResult = { root, totalFiles, otherFiles, languages };
  logEvent("project.analyzed", summarize(result));
  return result;
}

export interface AnalyzeStatus {
  analyzed: boolean;
  lastAnalyzed: string | null;
}

/** GET /api/analyze/status — whether this project has ever been analyzed (drives the panel banner). */
export function analyzeStatus(): AnalyzeStatus {
  const event = latestEvent("project.analyzed");
  return { analyzed: event !== undefined, lastAnalyzed: event?.created ?? null };
}
