import { readdir, readFile, stat } from "node:fs/promises";
import { execFile } from "node:child_process";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { readJson } from "./json-file.mjs";
import { GIT_HOOK_MARKER } from "./git-hooks.mjs";
import { CLAUDE_HOOK_TAG } from "./claude-settings.mjs";

const execFileAsync = promisify(execFile);

async function git(target, args) {
  const { stdout } = await execFileAsync("git", args, {
    cwd: target,
    encoding: "utf8",
  });
  return stdout.trim();
}

// Honors core.hooksPath (husky/lefthook redirect it) — --git-path hooks does not.
async function resolveGitHooksDir(target) {
  const root = await git(target, ["rev-parse", "--show-toplevel"]);
  const custom = await git(target, [
    "config",
    "--default",
    "",
    "--get",
    "core.hooksPath",
  ]);
  if (custom) {
    return resolve(root, custom);
  }
  return resolve(target, await git(target, ["rev-parse", "--git-path", "hooks"]));
}

/**
 * Every executable hook script in the repo's effective hooks dir, `managed` flagged
 * for the ones captain-obvious wrote. `.sample` stubs git ships are skipped.
 */
export async function listGitHooks(target) {
  const dir = await resolveGitHooksDir(target);
  const entries = await readdir(dir).catch((err) => {
    if (err.code === "ENOENT") {
      return null;
    }
    throw err;
  });
  if (entries === null) {
    return { dir, hooks: [] };
  }
  const hooks = [];
  for (const name of entries.sort()) {
    if (name.endsWith(".sample")) {
      continue;
    }
    const file = join(dir, name);
    const info = await stat(file);
    if (!info.isFile()) {
      continue;
    }
    const content = await readFile(file, "utf8");
    hooks.push({
      name,
      path: file,
      executable: (info.mode & 0o111) !== 0,
      managed: content.includes(GIT_HOOK_MARKER),
    });
  }
  return { dir, hooks };
}

/**
 * Every Claude Code hook entry in `.claude/settings.json` (across all events),
 * `managed` flagged for the ones captain-obvious wrote. Absent file → no hooks.
 */
export async function listClaudeHooks(target) {
  const path = join(target, ".claude", "settings.json");
  const settings = await readJson(path);
  const events = settings.hooks ?? {};
  const hooks = [];
  for (const event of Object.keys(events)) {
    for (const entry of events[event]) {
      hooks.push({
        event,
        matcher: entry.matcher,
        managed: entry[CLAUDE_HOOK_TAG] === true,
        commands: (entry.hooks ?? []).map((h) => h.command),
      });
    }
  }
  return { path, hooks };
}

export async function collectHooks(target) {
  return {
    git: await listGitHooks(target),
    claude: await listClaudeHooks(target),
  };
}

function origin(managed) {
  return managed ? "captain-obvious" : "external";
}

export function formatHooks({ git: gitHooks, claude }) {
  const lines = [`git hooks (${gitHooks.dir}):`];
  if (gitHooks.hooks.length === 0) {
    lines.push("  (none)");
  } else {
    for (const h of gitHooks.hooks) {
      const note = h.executable ? "" : " (not executable — git will skip it)";
      lines.push(`  ${h.name.padEnd(16)} ${origin(h.managed)}${note}`);
    }
  }
  lines.push("", `Claude Code hooks (${claude.path}):`);
  if (claude.hooks.length === 0) {
    lines.push("  (none)");
  } else {
    for (const h of claude.hooks) {
      const matcher = h.matcher ? h.matcher : "*";
      lines.push(
        `  ${h.event.padEnd(12)} ${matcher.padEnd(12)} ${origin(h.managed)}`,
      );
    }
  }
  return `${lines.join("\n")}\n`;
}
