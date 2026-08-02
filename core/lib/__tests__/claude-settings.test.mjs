import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { readJson, writeJson } from "../json-file.mjs";
import { installClaudeHooks } from "../claude-settings.mjs";

const SCRATCH = tmpdir();

describe("claude-settings / installClaudeHooks", () => {
  let dir;
  let target;
  let pkgRoot;

  beforeEach(async () => {
    dir = await mkdtemp(join(SCRATCH, "claude-settings-"));
    target = join(dir, "repo");
    pkgRoot = join(dir, "pkg");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const settingsPath = () => join(target, ".claude", "settings.json");

  test("returns [] when claudeHooks is undefined", async () => {
    expect(
      await installClaudeHooks({ target, pkgRoot, claudeHooks: undefined }),
    ).toEqual([]);
  });

  test("returns [] when claudeHooks is empty", async () => {
    expect(
      await installClaudeHooks({ target, pkgRoot, claudeHooks: [] }),
    ).toEqual([]);
  });

  test("writes a hook entry with the resolved bash command and default timeout", async () => {
    const written = await installClaudeHooks({
      target,
      pkgRoot,
      claudeHooks: [{ event: "PreToolUse", hook: "dispatch-guard" }],
    });
    expect(written).toEqual([settingsPath()]);

    const settings = await readJson(settingsPath());
    const entry = settings.hooks.PreToolUse[0];
    expect(entry._captainObvious).toBe(true);
    const relClaude = relative(target, join(pkgRoot, "hooks", "claude"));
    expect(entry.hooks[0]).toEqual({
      type: "command",
      command: `bash \${CLAUDE_PROJECT_DIR}/${relClaude}/dispatch-guard.sh`,
      timeout: 5,
    });
    expect(entry.matcher).toBeUndefined();
  });

  test("honors a custom timeout and matcher", async () => {
    await installClaudeHooks({
      target,
      pkgRoot,
      claudeHooks: [
        {
          event: "PreToolUse",
          hook: "dispatch-guard",
          timeout: 30,
          matcher: "Bash",
        },
      ],
    });
    const settings = await readJson(settingsPath());
    const entry = settings.hooks.PreToolUse[0];
    expect(entry.matcher).toBe("Bash");
    expect(entry.hooks[0].timeout).toBe(30);
  });

  test("re-running replaces prior _captainObvious entries but keeps hand-authored hooks", async () => {
    await writeJson(settingsPath(), {
      hooks: {
        PreToolUse: [
          {
            matcher: "Bash",
            hooks: [{ type: "command", command: "echo mine" }],
          },
          {
            _captainObvious: true,
            hooks: [{ type: "command", command: "stale" }],
          },
        ],
      },
    });

    await installClaudeHooks({
      target,
      pkgRoot,
      claudeHooks: [{ event: "PreToolUse", hook: "dispatch-guard" }],
    });

    const settings = await readJson(settingsPath());
    const commands = settings.hooks.PreToolUse.map((e) => e.hooks[0].command);
    expect(commands).toContain("echo mine");
    expect(commands).not.toContain("stale");
    expect(
      settings.hooks.PreToolUse.filter((e) => e._captainObvious),
    ).toHaveLength(1);
  });

  test("groups multiple hooks by their event, creating the event array on demand", async () => {
    await installClaudeHooks({
      target,
      pkgRoot,
      claudeHooks: [
        { event: "PreToolUse", hook: "a" },
        { event: "PreToolUse", hook: "b" },
        { event: "Stop", hook: "c" },
      ],
    });
    const settings = await readJson(settingsPath());
    expect(settings.hooks.PreToolUse).toHaveLength(2);
    expect(settings.hooks.Stop).toHaveLength(1);
  });
});
