import { access, rm } from "node:fs/promises";
import { join } from "node:path";
import { readJson, writeJson } from "./json-file.mjs";
import { listGitHooks } from "./list-hooks.mjs";
import { CLAUDE_HOOK_TAG } from "./claude-settings.mjs";

/**
 * Every uninstall step is inventory-first: it computes what it would remove and only
 * writes when `apply` is set, so the same code path drives both the dry-run preview
 * (default) and the real removal. Detection reuses the install-side markers —
 * GIT_HOOK_MARKER, `_captainObvious`, `captainObvious.managedScripts` — so we only
 * ever touch what we wrote and leave hand-authored hooks alone.
 */

/**
 * Delete every managed git hook (the ones carrying GIT_HOOK_MARKER) from the repo's
 * effective hooks dir. Returns the dir and the paths removed (or that would be).
 */
export async function uninstallGitHooks(target, { apply = false } = {}) {
  const { dir, hooks } = await listGitHooks(target);
  const removed = [];
  for (const hook of hooks) {
    if (!hook.managed) continue;
    if (apply) await rm(hook.path);
    removed.push(hook.path);
  }
  return { dir, removed };
}

/**
 * Strip every entry this installer wrote (tagged `_captainObvious`) from
 * `.claude/settings.json`, dropping any event array left empty and the `hooks` key
 * if nothing remains. Hand-authored hooks stay. Returns the path and how many
 * entries were removed; the file is rewritten only when that count is non-zero.
 */
export async function uninstallClaudeHooks(target, { apply = false } = {}) {
  const path = join(target, ".claude", "settings.json");
  const settings = await readJson(path, null);
  if (settings === null || !settings.hooks) return { path, removed: 0 };
  let removed = 0;
  for (const event of Object.keys(settings.hooks)) {
    const kept = settings.hooks[event].filter(
      (entry) => !entry[CLAUDE_HOOK_TAG],
    );
    removed += settings.hooks[event].length - kept.length;
    if (kept.length === 0) delete settings.hooks[event];
    else settings.hooks[event] = kept;
  }
  if (Object.keys(settings.hooks).length === 0) delete settings.hooks;
  if (apply && removed > 0) await writeJson(path, settings);
  return { path, removed };
}

/**
 * Remove the `lint:*` / `panel` aliases this installer manages (tracked under
 * `captainObvious.managedScripts`) from the consumer's package.json, then drop the
 * bookkeeping key. Scripts the consumer added by hand are untouched. Returns the
 * path and the removed keys.
 */
export async function uninstallNpmScripts(target, { apply = false } = {}) {
  const path = join(target, "package.json");
  const pkg = await readJson(path, null);
  if (pkg === null) return { path, removed: [] };
  const managed = pkg.captainObvious?.managedScripts ?? [];
  const removed = [];
  for (const key of managed) {
    if (pkg.scripts && key in pkg.scripts) {
      delete pkg.scripts[key];
      removed.push(key);
    }
  }
  if (managed.length === 0) return { path, removed };
  delete pkg.captainObvious.managedScripts;
  if (Object.keys(pkg.captainObvious).length === 0) delete pkg.captainObvious;
  if (apply) await writeJson(path, pkg);
  return { path, removed };
}

/** All three hook surfaces at once, sharing the `{ apply }` toggle. */
export async function uninstallHooks(target, opts = {}) {
  return {
    git: await uninstallGitHooks(target, opts),
    claude: await uninstallClaudeHooks(target, opts),
    npm: await uninstallNpmScripts(target, opts),
  };
}

/** True when any of the three surfaces has something managed to remove. */
export function anyManaged({ git, claude, npm }) {
  return git.removed.length > 0 || claude.removed > 0 || npm.removed.length > 0;
}

/**
 * Remove the local registry + audit DBs. `location` is the resolved `{ mode, dir }`
 * (from resolveModeLocation) or null when local mode has no repo root. Global-mode
 * data is shared machine-wide, so it is reported but never deleted here — wiping it
 * would break every other repo on the machine. Returns what happened, to print.
 */
export async function removeData(location, { apply = false } = {}) {
  if (location === null) return { removed: false, reason: "no-root" };
  if (location.mode === "global")
    return { removed: false, reason: "global", dir: location.dir };
  const existed = await access(location.dir).then(
    () => true,
    () => false,
  );
  if (!existed) return { removed: false, reason: "absent", dir: location.dir };
  if (apply) await rm(location.dir, { recursive: true });
  return { removed: true, dir: location.dir };
}

function verb(apply) {
  return apply ? "removed" : "would remove";
}

export function formatHooksUninstall({ git, claude, npm }, apply) {
  const v = verb(apply);
  const lines = [`git hooks (${git.dir}):`];
  if (git.removed.length === 0) lines.push("  (none managed)");
  else for (const p of git.removed) lines.push(`  ${v} ${p}`);
  lines.push("", `Claude Code hooks (${claude.path}):`);
  lines.push(
    claude.removed === 0
      ? "  (none managed)"
      : `  ${v} ${claude.removed} tagged entr${claude.removed === 1 ? "y" : "ies"}`,
  );
  lines.push("", `npm scripts (${npm.path}):`);
  if (npm.removed.length === 0) lines.push("  (none managed)");
  else for (const k of npm.removed) lines.push(`  ${v} ${k}`);
  return `${lines.join("\n")}\n`;
}

export function formatDataRemoval(data, apply) {
  if (data.reason === "no-root")
    return "registry data: no repo root found — nothing to remove\n";
  if (data.reason === "global")
    return `registry data: ${data.dir} is global (shared machine-wide) — left in place; remove it by hand to wipe every repo\n`;
  if (data.reason === "absent")
    return `registry data (${data.dir}): (absent)\n`;
  return `registry data: ${verb(apply)} ${data.dir}\n`;
}
