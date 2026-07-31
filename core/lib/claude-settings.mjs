import { join, relative } from "node:path";
import { readJson, writeJson } from "./json-file.mjs";

const PROJECT_DIR = "${CLAUDE_PROJECT_DIR}";

function entryFor(spec, relClaude) {
  const command = `bash ${PROJECT_DIR}/${relClaude}/${spec.hook}.sh`;
  const entry = {
    _captainObvious: true,
    hooks: [{ type: "command", command, timeout: spec.timeout ?? 5 }],
  };
  return spec.matcher ? { matcher: spec.matcher, ...entry } : entry;
}

/**
 * Merge the configured Claude hooks into `.claude/settings.json`, replacing any
 * entries this installer previously wrote (tagged `_captainObvious`) so re-running
 * is idempotent and leaves hand-authored hooks untouched. Returns the path written.
 */
export async function installClaudeHooks({ target, pkgRoot, claudeHooks }) {
  if (!claudeHooks || claudeHooks.length === 0) {
    return [];
  }
  const relClaude = relative(target, join(pkgRoot, "hooks", "claude"));
  const path = join(target, ".claude", "settings.json");
  const settings = await readJson(path);
  settings.hooks ??= {};
  for (const event of Object.keys(settings.hooks)) {
    settings.hooks[event] = settings.hooks[event].filter(
      (entry) => !entry._captainObvious,
    );
  }
  for (const spec of claudeHooks) {
    settings.hooks[spec.event] ??= [];
    settings.hooks[spec.event].push(entryFor(spec, relClaude));
  }
  await writeJson(path, settings);
  return [path];
}
