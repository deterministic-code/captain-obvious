import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { installGitHooks, renderHook } from "../git-hooks.mjs";

const execFileAsync = promisify(execFile);

const PRE_COMMIT = {
  hook: "pre-commit",
  claude: "pre-commit",
  cli: "git-pre-commit",
  configKey: "preCommit",
};
const PRE_PUSH = {
  hook: "pre-push",
  claude: "pre-push",
  cli: "git-pre-push",
  configKey: "prePush",
};

describe("renderHook", () => {
  it("branches on CLAUDECODE and dispatches the resolved stage, failing on non-zero", () => {
    const script = renderHook(PRE_COMMIT, "hooks/git", []);
    expect(script).toContain(
      'if [ "$CLAUDECODE" = "1" ]; then stage=pre-commit; else stage=git-pre-commit; fi',
    );
    expect(script).toContain(
      'node "$ROOT/hooks/git/dispatch.mjs" "$stage" || exit 1',
    );
    expect(script.startsWith("#!/bin/sh\n")).toBe(true);
  });

  it("uses the hook's own Claude/CLI stage pair (pre-push)", () => {
    expect(renderHook(PRE_PUSH, "hooks/git", [])).toContain(
      "then stage=pre-push; else stage=git-pre-push; fi",
    );
  });

  it("appends run: passthroughs after the dispatch line, each blocking", () => {
    const script = renderHook(PRE_PUSH, "hooks/git", ["npm run test:unit"]);
    const lines = script.trim().split("\n");
    expect(lines.at(-2)).toBe(
      'node "$ROOT/hooks/git/dispatch.mjs" "$stage" || exit 1',
    );
    expect(lines.at(-1)).toBe("npm run test:unit || exit 1");
  });
});

describe("installGitHooks", () => {
  const dirs = [];

  afterEach(async () => {
    await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
    dirs.length = 0;
  });

  async function tempRepo() {
    const dir = await mkdtemp(join(tmpdir(), "co-hooks-"));
    dirs.push(dir);
    await execFileAsync("git", ["init"], { cwd: dir });
    return dir;
  }

  it("writes every client-side hook, with only run: passthroughs per hook", async () => {
    const target = await tempRepo();
    const written = await installGitHooks({
      target,
      pkgRoot: target,
      gitHooks: {
        preCommit: ["run: npm test", "lint-naming"],
        prePush: ["run: npm run build"],
      },
    });

    const byName = Object.fromEntries(written.map((p) => [basename(p), p]));
    expect(Object.keys(byName).sort()).toEqual([
      "commit-msg",
      "pre-commit",
      "pre-merge-commit",
      "pre-push",
      "pre-rebase",
    ]);

    const preCommit = await readFile(byName["pre-commit"], "utf8");
    expect(preCommit).toContain("then stage=pre-commit; else stage=git-pre-commit");
    expect(preCommit).toContain("npm test || exit 1");
    // Rule entries are filtered out; only run: passthroughs survive.
    expect(preCommit).not.toContain("lint-naming");

    const prePush = await readFile(byName["pre-push"], "utf8");
    expect(prePush).toContain("then stage=pre-push; else stage=git-pre-push");
    expect(prePush).toContain("npm run build || exit 1");

    for (const file of written) {
      const { mode } = await stat(file);
      expect(mode & 0o111).toBeTruthy();
    }
  });

  it("writes dispatch-only hooks when a stage key is missing", async () => {
    const target = await tempRepo();
    const written = await installGitHooks({
      target,
      pkgRoot: target,
      gitHooks: {},
    });

    for (const file of written) {
      const script = await readFile(file, "utf8");
      const lines = script.trim().split("\n");
      // The dispatch line is the last (only) blocking line — no run: passthroughs.
      expect(lines.at(-1)).toContain("dispatch.mjs");
      expect(lines.filter((l) => l.endsWith("|| exit 1"))).toHaveLength(1);
    }
  });

  async function tempWorktree() {
    const main = await mkdtemp(join(tmpdir(), "co-hooks-main-"));
    dirs.push(main);
    await execFileAsync("git", ["init"], { cwd: main });
    await execFileAsync("git", ["config", "user.email", "t@example.com"], {
      cwd: main,
    });
    await execFileAsync("git", ["config", "user.name", "t"], { cwd: main });
    await execFileAsync("git", ["commit", "--allow-empty", "-m", "init"], {
      cwd: main,
    });
    const wt = `${main}-wt`;
    dirs.push(wt);
    await execFileAsync("git", ["worktree", "add", wt, "-b", "wtb"], {
      cwd: main,
    });
    return wt;
  }

  it("resolves shared hooks dir from a linked worktree (absolute --git-path)", async () => {
    const target = await tempWorktree();
    const [preCommitPath] = await installGitHooks({
      target,
      pkgRoot: target,
      gitHooks: {},
    });
    // Bug: joined absolute path onto target. Fix: resolve to real shared hooks dir.
    expect(preCommitPath.startsWith(target)).toBe(false);
    expect(await readFile(preCommitPath, "utf8")).toContain("dispatch.mjs");
  });

  it("returns empty array and writes nothing when gitHooks.enabled is false", async () => {
    const target = await tempRepo();
    const written = await installGitHooks({
      target,
      pkgRoot: target,
      gitHooks: { enabled: false },
    });

    expect(written).toHaveLength(0);
  });
});
