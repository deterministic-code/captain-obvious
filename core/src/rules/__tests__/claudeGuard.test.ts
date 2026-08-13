import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:child_process", () => ({ execFile: vi.fn() }));

import { execFile } from "node:child_process";
import { listHookRuns, openAuditDb } from "../../db/audit.js";
import { openDb, type Db } from "../../db/open.js";
import { configureProject, ensureDefaultProject } from "../../db/projects.js";
import { seedRules } from "../../db/seed.js";
import {
  evaluateGuard,
  evaluateMainBranch,
  forbiddenGitDir,
  formatGuardOutput,
  runToolGuards,
} from "../claudeGuard.js";
import { RULES } from "../index.js";

const execFileMock = vi.mocked(execFile);

/** Make `git symbolic-ref` resolve to `branch` (or fail, for a detached HEAD). */
function mockBranch(branch: string | null): void {
  execFileMock.mockImplementation(((
    _cmd: string,
    _args: string[],
    ...rest: unknown[]
  ) => {
    const cb = rest[rest.length - 1] as (e: unknown, r: unknown) => void;
    if (branch === null) cb(new Error("detached"), null);
    else cb(null, { stdout: `${branch}\n`, stderr: "" });
  }) as never);
}

const REPO = "/repo";
const PROTECTED = ["db/schema.sql", ".github/**"];

function edit(filePath: string, tool = "Edit"): string {
  return JSON.stringify({ tool_name: tool, tool_input: { file_path: filePath } });
}
function bash(command: string, cwd?: string): string {
  return JSON.stringify({ tool_name: "Bash", tool_input: { command }, cwd });
}

afterEach(() => {
  execFileMock.mockReset();
});

describe("evaluateGuard", () => {
  it("allows a tool that is not an editing tool", () => {
    expect(evaluateGuard(bash("ls"), REPO, PROTECTED)).toEqual({ deny: false });
  });

  it("allows an editing tool with no file_path", () => {
    const input = JSON.stringify({ tool_name: "Edit", tool_input: {} });
    expect(evaluateGuard(input, REPO, PROTECTED)).toEqual({ deny: false });
  });

  it("allows a file outside the repo root and the root itself", () => {
    expect(evaluateGuard(edit("/elsewhere/x.ts"), REPO, PROTECTED).deny).toBe(false);
    expect(evaluateGuard(edit(REPO), REPO, PROTECTED).deny).toBe(false);
  });

  it("allows an in-repo file matching no protected glob", () => {
    expect(evaluateGuard(edit("/repo/src/index.ts"), REPO, PROTECTED).deny).toBe(
      false,
    );
  });

  it("denies an in-repo file matching a protected glob, across tools", () => {
    expect(evaluateGuard(edit("/repo/db/schema.sql"), REPO, PROTECTED).deny).toBe(
      true,
    );
    expect(
      evaluateGuard(edit("/repo/.github/workflows/ci.yml", "Write"), REPO, PROTECTED)
        .deny,
    ).toBe(true);
  });
});

describe("forbiddenGitDir", () => {
  it("returns null for a command with no guarded git op", () => {
    expect(forbiddenGitDir("ls -la && echo hi", "/w")).toBeNull();
  });
  it("flags a forbidden git op in the base cwd", () => {
    expect(forbiddenGitDir("git commit -m x", "/w")).toBe("/w");
  });
  it("follows cd before the git op", () => {
    expect(forbiddenGitDir("cd sub && git add .", "/w")).toBe("/w/sub");
  });
  it("follows git -C to resolve the op's dir (relative and absolute)", () => {
    expect(forbiddenGitDir("git -C other reset --hard", "/w")).toBe("/w/other");
    expect(forbiddenGitDir("git -C /abs commit -m x", "/w")).toBe("/abs");
  });
  it("ignores empty statements and absolute cd targets", () => {
    expect(forbiddenGitDir("cd /abs ;; git stash", "/w")).toBe("/abs");
  });
});

describe("evaluateMainBranch", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "co-guard-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("allows everything under the ALLOW_EDIT_ON_MAIN bypass", async () => {
    const v = await evaluateMainBranch(edit(join(dir, "x.ts")), dir, ["main"], {
      ALLOW_EDIT_ON_MAIN: "1",
    });
    expect(v).toEqual({ deny: false });
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it("allows an edit with no file_path", async () => {
    const input = JSON.stringify({ tool_name: "Edit", tool_input: {} });
    expect((await evaluateMainBranch(input, dir, ["main"], {})).deny).toBe(false);
  });

  it("denies an edit whose repo is on a protected branch", async () => {
    mockBranch("main");
    const v = await evaluateMainBranch(edit(join(dir, "x.ts")), dir, ["main"], {});
    expect(v.deny).toBe(true);
    expect(v.reason).toContain("BLOCKED on branch 'main'");
  });

  it("allows an edit whose repo is on a feature branch", async () => {
    mockBranch("feature");
    expect(
      (await evaluateMainBranch(edit(join(dir, "x.ts")), dir, ["main"], {})).deny,
    ).toBe(false);
  });

  it("allows when the target dir does not exist", async () => {
    expect(
      (await evaluateMainBranch(edit("/nope/x.ts"), dir, ["main"], {})).deny,
    ).toBe(false);
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it("denies a forbidden git command on a protected branch", async () => {
    mockBranch("main");
    const v = await evaluateMainBranch(bash("git commit -m x", dir), dir, ["main"], {});
    expect(v.deny).toBe(true);
  });

  it("falls back to the passed cwd for a Bash event carrying no cwd", async () => {
    mockBranch("main");
    const input = JSON.stringify({
      tool_name: "Bash",
      tool_input: { command: "git commit -m x" },
    });
    expect((await evaluateMainBranch(input, dir, ["main"], {})).deny).toBe(true);
  });

  it("allows a benign bash command and an inline bypass", async () => {
    expect((await evaluateMainBranch(bash("ls", dir), dir, ["main"], {})).deny).toBe(
      false,
    );
    expect(
      (await evaluateMainBranch(bash("ALLOW_EDIT_ON_MAIN=1 git commit", dir), dir, ["main"], {}))
        .deny,
    ).toBe(false);
    expect(
      (await evaluateMainBranch(JSON.stringify({ tool_name: "Bash", tool_input: {} }), dir, ["main"], {}))
        .deny,
    ).toBe(false);
  });

  it("allows a non-edit, non-bash tool", async () => {
    expect(
      (await evaluateMainBranch(JSON.stringify({ tool_name: "Read" }), dir, ["main"], {}))
        .deny,
    ).toBe(false);
  });
});

describe("runToolGuards", () => {
  let db: Db;
  let audit: Db;
  beforeEach(() => {
    db = openDb(":memory:");
    seedRules(db, RULES);
    audit = openAuditDb(":memory:");
    const p = ensureDefaultProject(db, REPO, "Repo");
    configureProject(db, p.id, { protected: PROTECTED });
  });
  afterEach(() => {
    audit.close();
    db.close();
  });

  it("denies a protected edit and logs a hook_run for every tool guard", async () => {
    const decision = await runToolGuards(edit("/repo/db/schema.sql"), REPO, db, audit);
    expect(decision.deny).toBe(true);
    const slugs = listHookRuns(audit)
      .map((r) => r.slug)
      .sort();
    expect(slugs).toEqual(["gov-no-push-to-main", "lint-protected-paths"]);
  });

  it("allows a non-protected edit and records both guards as success", async () => {
    const decision = await runToolGuards(edit("/repo/src/index.ts"), REPO, db, audit);
    expect(decision.deny).toBe(false);
    expect(listHookRuns(audit).every((r) => r.status === "success")).toBe(true);
    expect(listHookRuns(audit)).toHaveLength(2);
  });

  it("skips a disabled guard rule", async () => {
    db.prepare("UPDATE rules SET enabled = 0 WHERE slug = ?").run(
      "lint-protected-paths",
    );
    await runToolGuards(edit("/repo/db/schema.sql"), REPO, db, audit);
    expect(listHookRuns(audit).map((r) => r.slug)).toEqual(["gov-no-push-to-main"]);
  });
});

describe("formatGuardOutput", () => {
  const denyPayload = {
    hookEventName: "PreToolUse",
    permissionDecision: "deny",
    permissionDecisionReason: "nope",
  };

  it("returns null when allowed and logging succeeded", () => {
    expect(formatGuardOutput({ deny: false })).toBeNull();
  });

  it("emits the deny decision", () => {
    expect(
      JSON.parse(formatGuardOutput({ deny: true, reason: "nope" }) as string),
    ).toEqual({ hookSpecificOutput: denyPayload });
  });

  it("adds a visible systemMessage when the audit write failed", () => {
    const out = JSON.parse(
      formatGuardOutput({ deny: true, reason: "nope" }, "boom") as string,
    );
    expect(out.hookSpecificOutput).toEqual(denyPayload);
    expect(out.systemMessage).toContain("boom");
  });

  it("surfaces an audit failure even when allowed", () => {
    const out = JSON.parse(formatGuardOutput({ deny: false }, "boom") as string);
    expect(out.hookSpecificOutput).toBeUndefined();
    expect(out.systemMessage).toContain("boom");
  });
});

describe("tool-stage guard invariant", () => {
  it("keeps the guard rules tool-staged", () => {
    const toolStaged = RULES.filter((r) => r.meta.stages.includes("tool")).map(
      (r) => r.meta.slug,
    );
    expect(toolStaged).toContain("lint-protected-paths");
    expect(toolStaged).toContain("gov-no-push-to-main");
  });
});
