import { join } from "node:path";
import { readJson, writeJson } from "./json-file.mjs";

/** `lint-comments` → `comments`; the short name used by the captain-obvious-lint bin and the npm alias. */
function shortName(stem) {
  return stem.replace(/^lint-/, "");
}

/** The one always-on convenience alias: launch the web control panel + /api. */
const PANEL_COMMAND = "captain-obvious serve";

/**
 * The package.json key the panel alias lands on. Defaults to `panel`; a consumer with
 * their own `panel` script can rename it via `npmScripts.panelScript: "co:panel"`, or
 * drop it entirely with `npmScripts.panelScript: false`.
 */
function panelKey(npmScripts) {
  const configured = npmScripts?.panelScript;
  if (configured === false) {
    return null;
  }
  return typeof configured === "string" ? configured : "panel";
}

/**
 * Derive the managed `lint:*` alias set from the git-hook config. Each lint hook gets
 * `lint:<name>` (--staged) and `lint:<name>:all`; hooks that run with --push also get
 * `lint:<name>:push`. `extraScripts` (key → bin args) overrides or adds the odd ones
 * (e.g. dead-code is --all-only, frozen-interfaces has --add/--update).
 */
function deriveScripts(gitHooks, extraScripts) {
  const entries = [...(gitHooks.preCommit ?? []), ...(gitHooks.prePush ?? [])];
  const stems = new Set();
  const hasPush = new Set();
  for (const entry of entries) {
    const [stem, ...flags] = entry.trim().split(/\s+/);
    if (stem === "run:") {
      continue;
    }
    stems.add(stem);
    if (flags.includes("--push")) {
      hasPush.add(stem);
    }
  }
  const scripts = {};
  for (const stem of stems) {
    const short = shortName(stem);
    scripts[`lint:${short}`] = `captain-obvious-lint ${short} --staged`;
    scripts[`lint:${short}:all`] = `captain-obvious-lint ${short} --all`;
    if (hasPush.has(stem)) {
      scripts[`lint:${short}:push`] = `captain-obvious-lint ${short} --push`;
    }
  }
  for (const [key, args] of Object.entries(extraScripts)) {
    scripts[key] = `captain-obvious-lint ${args}`;
  }
  return scripts;
}

/**
 * Rewrite the consumer's `package.json` `lint:*` aliases to run through the package,
 * so the reference wiring lives in one place. Tracks the keys it owns under
 * `captainObvious.managedScripts` to stay idempotent and to prune hooks that go away.
 * Returns the path written (or [] when disabled).
 */
export async function installNpmScripts({ target, gitHooks, npmScripts }) {
  if (npmScripts?.enabled === false) {
    return [];
  }
  const path = join(target, "package.json");
  const pkg = await readJson(path);
  pkg.scripts ??= {};
  pkg.captainObvious ??= {};
  for (const key of pkg.captainObvious.managedScripts ?? []) {
    delete pkg.scripts[key];
  }
  const generated = deriveScripts(
    gitHooks ?? {},
    npmScripts?.extraScripts ?? {},
  );
  const key = panelKey(npmScripts);
  if (key) {
    generated[key] = PANEL_COMMAND;
  }
  const managed = Object.keys(generated).sort();
  const next = { ...pkg.scripts };
  for (const key of managed) {
    next[key] = generated[key];
  }
  pkg.scripts = next;
  pkg.captainObvious.managedScripts = managed;
  await writeJson(path, pkg);
  return [path];
}
