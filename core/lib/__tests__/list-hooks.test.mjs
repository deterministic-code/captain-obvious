import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { renderHook, GIT_HOOK_MARKER } from "../git-hooks.mjs";
import { installGitHooks } from "../git-hooks.mjs";
import { installClaudeHooks, CLAUDE_HOOK_TAG } from "../claude-settings.mjs";
import { readJson, writeJson } from "../json-file.mjs";
import {
  collectHooks,
  formatHooks,
  listClaudeHooks,
  listGitHooks,
} from "../list-hooks.mjs";

const execFileAsync = promisify(execFile);

const CLAUDE_SPECS = [
  { event: "PreToolUse", matcher: "Edit|Write", hook: "main-branch-guard" },
  { event: "Stop", hook: "stop-unmerged-guard" },
];

describe("list-hooks", () => {
  const dirs = [];

  afterEach(async () => {
    await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
    dirs.length = 0;
  });

  async function tempRepo() {
    const dir = await mkdtemp(join(tmpdir(), "co-list-"));
    dirs.push(dir);
    await execFileAsync("git", ["init"], { cwd: dir });
    return dir;
  }

  it("classifies our git hooks as managed and foreign ones as external", async () => {
    const target = await tempRepo();
    await installGitHooks({ target, pkgRoot: target, gitHooks: {} });
    const hooksDir = join(target, ".git", "hooks");
    await writeFile(join(hooksDir, "commit-msg"), "#!/bin/sh\necho hi\n");
    await chmod(join(hooksDir, "commit-msg"), 0o755);
    await writeFile(join(hooksDir, "post-commit"), "#!/bin/sh\n");
    await chmod(join(hooksDir, "post-commit"), 0o644);
    await mkdir(join(hooksDir, "a-subdir"));

    const { hooks } = await listGitHooks(target);
    const byName = Object.fromEntries(hooks.map((h) => [h.name, h]));

    expect(byName["pre-commit"]).toMatchObject({
      managed: true,
      executable: true,
    });
    expect(byName["commit-msg"]).toMatchObject({
      managed: false,
      executable: true,
    });
    expect(byName["post-commit"]).toMatchObject({
      managed: false,
      executable: false,
    });
    expect(byName["a-subdir"]).toBeUndefined();
    expect(hooks.some((h) => h.name.endsWith(".sample"))).toBe(false);
  });

  it("honors core.hooksPath (husky/lefthook redirect)", async () => {
    const target = await tempRepo();
    await mkdir(join(target, "customhooks"));
    await writeFile(
      join(target, "customhooks", "pre-commit"),
      "#!/bin/sh\nnpx lint-staged\n",
    );
    await execFileAsync("git", ["config", "core.hooksPath", "customhooks"], {
      cwd: target,
    });

    const { dir, hooks } = await listGitHooks(target);
    expect(dir).toMatch(/[/\\]customhooks$/);
    expect(hooks.map((h) => h.name)).toEqual(["pre-commit"]);
    expect(hooks[0].managed).toBe(false);
  });

  it("reports no git hooks when the hooks dir is absent", async () => {
    const target = await tempRepo();
    await execFileAsync("git", ["config", "core.hooksPath", "nope"], {
      cwd: target,
    });
    expect((await listGitHooks(target)).hooks).toEqual([]);
  });

  it("rethrows non-ENOENT errors reading the hooks dir", async () => {
    const target = await tempRepo();
    await writeFile(join(target, "notadir"), "x");
    await execFileAsync("git", ["config", "core.hooksPath", "notadir"], {
      cwd: target,
    });
    await expect(listGitHooks(target)).rejects.toThrow();
  });

  it("classifies Claude hooks and reads their commands", async () => {
    const target = await tempRepo();
    await installClaudeHooks({
      target,
      pkgRoot: target,
      claudeHooks: CLAUDE_SPECS,
    });
    const path = join(target, ".claude", "settings.json");
    const settings = await readJson(path);
    settings.hooks.PreToolUse.push({
      matcher: "Bash",
      hooks: [{ type: "command", command: "echo foreign" }],
    });
    settings.hooks.PostToolUse = [{ note: "no hooks array here" }];
    await writeJson(path, settings);

    const { hooks } = await listClaudeHooks(target);
    const managed = hooks.find((h) => h.event === "PreToolUse" && h.managed);
    const stop = hooks.find((h) => h.event === "Stop");
    const foreign = hooks.find((h) => h.matcher === "Bash");
    const noHooks = hooks.find((h) => h.event === "PostToolUse");

    expect(managed).toMatchObject({ matcher: "Edit|Write" });
    expect(managed.commands[0]).toContain("main-branch-guard.sh");
    expect(stop).toMatchObject({ managed: true, matcher: undefined });
    expect(foreign).toMatchObject({ managed: false });
    expect(noHooks.commands).toEqual([]);
  });

  it("reports no Claude hooks when settings.json is absent", async () => {
    const target = await tempRepo();
    expect((await listClaudeHooks(target)).hooks).toEqual([]);
  });

  it("collectHooks returns both git and claude inventories", async () => {
    const target = await tempRepo();
    await installGitHooks({ target, pkgRoot: target, gitHooks: {} });
    await installClaudeHooks({
      target,
      pkgRoot: target,
      claudeHooks: CLAUDE_SPECS,
    });
    const inv = await collectHooks(target);
    expect(inv.git.hooks.length).toBeGreaterThan(0);
    expect(inv.claude.hooks.length).toBe(2);
  });

  it("formatHooks renders origins, the non-executable note, and matchers", () => {
    const text = formatHooks({
      git: {
        dir: "/repo/.git/hooks",
        hooks: [
          { name: "pre-commit", executable: true, managed: true },
          { name: "post-commit", executable: false, managed: false },
        ],
      },
      claude: {
        path: "/repo/.claude/settings.json",
        hooks: [
          { event: "PreToolUse", matcher: "Edit|Write", managed: true },
          { event: "Stop", matcher: undefined, managed: false },
        ],
      },
    });
    expect(text).toContain("captain-obvious");
    expect(text).toContain("external");
    expect(text).toContain("not executable");
    expect(text).toContain("Edit|Write");
    expect(text).toMatch(/Stop\s+\*\s+external/);
  });

  it("formatHooks says (none) for an empty inventory", () => {
    const text = formatHooks({
      git: { dir: "/repo/.git/hooks", hooks: [] },
      claude: { path: "/repo/.claude/settings.json", hooks: [] },
    });
    expect(text.match(/\(none\)/g)).toHaveLength(2);
  });

  it("renderHook output carries the marker list-hooks detects", () => {
    const spec = { claude: "pre-commit", cli: "git-pre-commit" };
    expect(renderHook(spec, "x/hooks/git", [])).toContain(GIT_HOOK_MARKER);
  });

  it("installClaudeHooks tags entries with the constant list-hooks detects", async () => {
    const target = await tempRepo();
    await installClaudeHooks({
      target,
      pkgRoot: target,
      claudeHooks: [CLAUDE_SPECS[1]],
    });
    const settings = await readJson(
      join(target, ".claude", "settings.json"),
    );
    expect(settings.hooks.Stop[0][CLAUDE_HOOK_TAG]).toBe(true);
  });
});
