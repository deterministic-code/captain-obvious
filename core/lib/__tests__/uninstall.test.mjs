import { execFile } from "node:child_process";
import { access, chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { installGitHooks } from "../git-hooks.mjs";
import { installClaudeHooks } from "../claude-settings.mjs";
import { installNpmScripts } from "../npm-scripts.mjs";
import { readJson, writeJson } from "../json-file.mjs";
import {
  anyManaged,
  formatDataRemoval,
  formatHooksUninstall,
  removeData,
  uninstallClaudeHooks,
  uninstallGitHooks,
  uninstallHooks,
  uninstallNpmScripts,
} from "../uninstall.mjs";

const execFileAsync = promisify(execFile);

const CLAUDE_SPECS = [
  { event: "PreToolUse", matcher: "Edit|Write", hook: "main-branch-guard" },
  { event: "Stop", hook: "stop-unmerged-guard" },
];

const NPM_RULES = [
  { slug: "lint-comments", stages: ["pre-commit"], hasCheck: true },
];

const exists = (p) =>
  access(p).then(
    () => true,
    () => false,
  );

describe("uninstall", () => {
  const dirs = [];

  afterEach(async () => {
    await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
    dirs.length = 0;
  });

  async function tempRepo() {
    const dir = await mkdtemp(join(tmpdir(), "co-uninstall-"));
    dirs.push(dir);
    await execFileAsync("git", ["init"], { cwd: dir });
    return dir;
  }

  describe("uninstallGitHooks", () => {
    it("removes only managed hooks when applied, leaving foreign ones", async () => {
      const target = await tempRepo();
      await installGitHooks({ target, pkgRoot: target, gitHooks: {} });
      const hooksDir = join(target, ".git", "hooks");
      const foreign = join(hooksDir, "post-commit");
      await writeFile(foreign, "#!/bin/sh\necho hi\n");
      await chmod(foreign, 0o755);

      const { dir, removed } = await uninstallGitHooks(target, { apply: true });
      expect(dir).toBe(hooksDir);
      expect(removed).toContain(join(hooksDir, "pre-commit"));
      expect(await exists(join(hooksDir, "pre-commit"))).toBe(false);
      expect(await exists(foreign)).toBe(true);
    });

    it("dry run reports managed hooks without deleting them", async () => {
      const target = await tempRepo();
      await installGitHooks({ target, pkgRoot: target, gitHooks: {} });
      const { removed } = await uninstallGitHooks(target);
      expect(removed.length).toBeGreaterThan(0);
      expect(await exists(join(target, ".git", "hooks", "pre-commit"))).toBe(
        true,
      );
    });

    it("removes nothing when no managed hooks are present", async () => {
      const target = await tempRepo();
      const { removed } = await uninstallGitHooks(target, { apply: true });
      expect(removed).toEqual([]);
    });
  });

  describe("uninstallClaudeHooks", () => {
    it("strips tagged entries, keeps foreign ones, prunes empty events", async () => {
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
      await writeJson(path, settings);

      const { removed } = await uninstallClaudeHooks(target, { apply: true });
      expect(removed).toBe(2);
      const after = await readJson(path);
      expect(after.hooks.Stop).toBeUndefined();
      expect(after.hooks.PreToolUse).toHaveLength(1);
      expect(after.hooks.PreToolUse[0].matcher).toBe("Bash");
    });

    it("drops the hooks key when every managed entry is removed", async () => {
      const target = await tempRepo();
      await installClaudeHooks({
        target,
        pkgRoot: target,
        claudeHooks: CLAUDE_SPECS,
      });
      const path = join(target, ".claude", "settings.json");
      await uninstallClaudeHooks(target, { apply: true });
      const after = await readJson(path);
      expect(after.hooks).toBeUndefined();
    });

    it("dry run counts entries without rewriting the file", async () => {
      const target = await tempRepo();
      await installClaudeHooks({
        target,
        pkgRoot: target,
        claudeHooks: CLAUDE_SPECS,
      });
      const path = join(target, ".claude", "settings.json");
      const { removed } = await uninstallClaudeHooks(target);
      expect(removed).toBe(2);
      expect((await readJson(path)).hooks.Stop).toHaveLength(1);
    });

    it("returns zero when settings.json is absent", async () => {
      const target = await tempRepo();
      const { removed } = await uninstallClaudeHooks(target, { apply: true });
      expect(removed).toBe(0);
    });

    it("returns zero when settings.json has no hooks key", async () => {
      const target = await tempRepo();
      const path = join(target, ".claude", "settings.json");
      await writeJson(path, { other: true });
      const { removed } = await uninstallClaudeHooks(target, { apply: true });
      expect(removed).toBe(0);
    });

    it("leaves a hand-authored settings file untouched (no managed entries)", async () => {
      const target = await tempRepo();
      const path = join(target, ".claude", "settings.json");
      await writeJson(path, {
        hooks: { Stop: [{ hooks: [{ type: "command", command: "mine" }] }] },
      });
      const { removed } = await uninstallClaudeHooks(target, { apply: true });
      expect(removed).toBe(0);
      expect((await readJson(path)).hooks.Stop).toHaveLength(1);
    });
  });

  describe("uninstallNpmScripts", () => {
    async function withPkg(target) {
      await writeJson(join(target, "package.json"), { name: "x", scripts: {} });
    }

    it("removes managed script keys and the bookkeeping key", async () => {
      const target = await tempRepo();
      await withPkg(target);
      await installNpmScripts({ target, rules: NPM_RULES, npmScripts: {} });
      const path = join(target, "package.json");
      const before = await readJson(path);
      expect(before.captainObvious.managedScripts.length).toBeGreaterThan(0);
      expect(before.scripts.panel).toBe("captain-obvious serve");

      const { removed } = await uninstallNpmScripts(target, { apply: true });
      expect(removed).toContain("panel");
      const after = await readJson(path);
      expect(after.scripts.panel).toBeUndefined();
      expect(after.captainObvious).toBeUndefined();
    });

    it("keeps a sibling captainObvious key while dropping managedScripts", async () => {
      const target = await tempRepo();
      await writeJson(join(target, "package.json"), {
        scripts: { panel: "captain-obvious serve", mine: "echo hi" },
        captainObvious: { managedScripts: ["panel"], other: 1 },
      });
      const { removed } = await uninstallNpmScripts(target, { apply: true });
      expect(removed).toEqual(["panel"]);
      const after = await readJson(join(target, "package.json"));
      expect(after.scripts).toEqual({ mine: "echo hi" });
      expect(after.captainObvious).toEqual({ other: 1 });
    });

    it("returns [] when package.json is absent", async () => {
      const target = await tempRepo();
      const { removed } = await uninstallNpmScripts(target, { apply: true });
      expect(removed).toEqual([]);
    });

    it("returns [] when there are no managed scripts", async () => {
      const target = await tempRepo();
      await writeJson(join(target, "package.json"), { scripts: { mine: "x" } });
      const { removed } = await uninstallNpmScripts(target, { apply: true });
      expect(removed).toEqual([]);
    });

    it("skips managed keys already deleted by hand", async () => {
      const target = await tempRepo();
      await writeJson(join(target, "package.json"), {
        scripts: {},
        captainObvious: { managedScripts: ["panel"] },
      });
      const { removed } = await uninstallNpmScripts(target, { apply: true });
      expect(removed).toEqual([]);
      const after = await readJson(join(target, "package.json"));
      expect(after.captainObvious).toBeUndefined();
    });

    it("dry run leaves package.json untouched", async () => {
      const target = await tempRepo();
      await withPkg(target);
      await installNpmScripts({ target, rules: NPM_RULES, npmScripts: {} });
      const { removed } = await uninstallNpmScripts(target);
      expect(removed).toContain("panel");
      expect((await readJson(join(target, "package.json"))).scripts.panel).toBe(
        "captain-obvious serve",
      );
    });
  });

  describe("uninstallHooks + anyManaged", () => {
    it("aggregates all three surfaces", async () => {
      const target = await tempRepo();
      await installGitHooks({ target, pkgRoot: target, gitHooks: {} });
      await installClaudeHooks({
        target,
        pkgRoot: target,
        claudeHooks: CLAUDE_SPECS,
      });
      await writeJson(join(target, "package.json"), { scripts: {} });
      await installNpmScripts({ target, rules: NPM_RULES, npmScripts: {} });

      const result = await uninstallHooks(target, { apply: true });
      expect(result.git.removed.length).toBeGreaterThan(0);
      expect(result.claude.removed).toBe(2);
      expect(result.npm.removed).toContain("panel");
      expect(anyManaged(result)).toBe(true);
    });

    it("anyManaged is false on a clean repo", async () => {
      const target = await tempRepo();
      await writeJson(join(target, "package.json"), { scripts: {} });
      const result = await uninstallHooks(target);
      expect(anyManaged(result)).toBe(false);
    });
  });

  describe("removeData", () => {
    it("returns no-root when location is null", async () => {
      expect(await removeData(null)).toEqual({
        removed: false,
        reason: "no-root",
      });
    });

    it("never deletes global data, only reports it", async () => {
      const target = await tempRepo();
      const dir = join(target, ".captain-obvious");
      await mkdir(dir);
      const res = await removeData({ mode: "global", dir }, { apply: true });
      expect(res).toEqual({ removed: false, reason: "global", dir });
      expect(await exists(dir)).toBe(true);
    });

    it("reports absent local data", async () => {
      const target = await tempRepo();
      const dir = join(target, ".captain-obvious");
      const res = await removeData({ mode: "local", dir }, { apply: true });
      expect(res).toEqual({ removed: false, reason: "absent", dir });
    });

    it("removes present local data when applied", async () => {
      const target = await tempRepo();
      const dir = join(target, ".captain-obvious");
      await mkdir(dir);
      await writeFile(join(dir, "captain-obvious.db"), "x");
      const res = await removeData({ mode: "local", dir }, { apply: true });
      expect(res).toEqual({ removed: true, dir });
      expect(await exists(dir)).toBe(false);
    });

    it("dry run keeps present local data", async () => {
      const target = await tempRepo();
      const dir = join(target, ".captain-obvious");
      await mkdir(dir);
      const res = await removeData({ mode: "local", dir });
      expect(res).toEqual({ removed: true, dir });
      expect(await exists(dir)).toBe(true);
    });
  });

  describe("formatHooksUninstall", () => {
    const managed = {
      git: {
        dir: "/repo/.git/hooks",
        removed: ["/repo/.git/hooks/pre-commit"],
      },
      claude: { path: "/repo/.claude/settings.json", removed: 2 },
      npm: { path: "/repo/package.json", removed: ["panel"] },
    };

    it("uses 'removed' phrasing when applied and pluralizes entries", () => {
      const text = formatHooksUninstall(managed, true);
      expect(text).toContain("removed /repo/.git/hooks/pre-commit");
      expect(text).toContain("removed 2 tagged entries");
      expect(text).toContain("removed panel");
    });

    it("uses 'would remove' phrasing and singular entry in dry run", () => {
      const text = formatHooksUninstall(
        { ...managed, claude: { path: "/p", removed: 1 } },
        false,
      );
      expect(text).toContain("would remove");
      expect(text).toContain("would remove 1 tagged entry");
    });

    it("says (none managed) for every empty surface", () => {
      const text = formatHooksUninstall(
        {
          git: { dir: "/d", removed: [] },
          claude: { path: "/p", removed: 0 },
          npm: { path: "/pkg", removed: [] },
        },
        true,
      );
      expect(text.match(/\(none managed\)/g)).toHaveLength(3);
    });
  });

  describe("formatDataRemoval", () => {
    it("covers every reason and the removed case", () => {
      expect(
        formatDataRemoval({ removed: false, reason: "no-root" }, false),
      ).toContain("no repo root");
      expect(
        formatDataRemoval(
          { removed: false, reason: "global", dir: "/g" },
          false,
        ),
      ).toContain("global");
      expect(
        formatDataRemoval(
          { removed: false, reason: "absent", dir: "/a" },
          false,
        ),
      ).toContain("(absent)");
      expect(formatDataRemoval({ removed: true, dir: "/d" }, true)).toContain(
        "removed /d",
      );
      expect(formatDataRemoval({ removed: true, dir: "/d" }, false)).toContain(
        "would remove /d",
      );
    });
  });
});
