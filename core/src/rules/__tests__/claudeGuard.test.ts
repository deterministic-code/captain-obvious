import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDb, type Db } from "../../db/open.js";
import { configureProject, ensureDefaultProject } from "../../db/projects.js";
import { seedRules } from "../../db/seed.js";
import {
  evaluateGuard,
  formatGuardOutput,
  guardDecision,
} from "../claudeGuard.js";
import { RULES } from "../index.js";

const REPO = "/repo";
const PROTECTED = ["db/schema.sql", ".github/**"];

function edit(filePath: string, tool = "Edit"): string {
  return JSON.stringify({
    tool_name: tool,
    tool_input: { file_path: filePath },
  });
}

describe("evaluateGuard", () => {
  it("allows a tool that is not an editing tool", () => {
    const input = JSON.stringify({
      tool_name: "Bash",
      tool_input: { command: "ls" },
    });
    expect(evaluateGuard(input, REPO, PROTECTED)).toEqual({ deny: false });
  });

  it("allows an editing tool with no file_path", () => {
    const input = JSON.stringify({ tool_name: "Edit", tool_input: {} });
    expect(evaluateGuard(input, REPO, PROTECTED)).toEqual({ deny: false });
  });

  it("allows a file outside the repo root", () => {
    expect(evaluateGuard(edit("/elsewhere/x.ts"), REPO, PROTECTED)).toEqual({
      deny: false,
    });
  });

  it("allows when the path is the repo root itself", () => {
    expect(evaluateGuard(edit(REPO), REPO, PROTECTED)).toEqual({ deny: false });
  });

  it("allows an in-repo file that matches no protected glob", () => {
    expect(evaluateGuard(edit("/repo/src/index.ts"), REPO, PROTECTED)).toEqual({
      deny: false,
    });
  });

  it("denies an in-repo file that matches a protected glob", () => {
    const decision = evaluateGuard(
      edit("/repo/db/schema.sql"),
      REPO,
      PROTECTED,
    );
    expect(decision.deny).toBe(true);
    expect(decision.reason).toContain("db/schema.sql");
  });

  it("denies across all editing tools and globstar patterns", () => {
    const decision = evaluateGuard(
      edit("/repo/.github/workflows/ci.yml", "Write"),
      REPO,
      PROTECTED,
    );
    expect(decision.deny).toBe(true);
  });
});

describe("guardDecision", () => {
  let db: Db;

  beforeEach(() => {
    db = openDb(":memory:");
    seedRules(db, RULES);
    const p = ensureDefaultProject(db, REPO, "Repo");
    configureProject(db, p.id, { protected: PROTECTED });
  });

  afterEach(() => {
    db.close();
  });

  it("denies a protected edit when the rule is enabled at the tool stage", () => {
    expect(
      guardDecision(edit("/repo/db/schema.sql"), REPO, db).decision.deny,
    ).toBe(true);
  });

  it("logs a failure hook_run for a denied protected edit", () => {
    expect(guardDecision(edit("/repo/db/schema.sql"), REPO, db).run).toEqual({
      slug: "lint-protected-paths",
      stage: "tool",
      status: "failure",
    });
  });

  it("logs a success hook_run when the rule runs but allows the edit", () => {
    expect(guardDecision(edit("/repo/src/index.ts"), REPO, db)).toEqual({
      decision: { deny: false },
      run: {
        slug: "lint-protected-paths",
        stage: "tool",
        status: "success",
      },
    });
  });

  it("allows and logs nothing when lint-protected-paths is disabled", () => {
    db.prepare("UPDATE rules SET enabled = 0 WHERE slug = ?").run(
      "lint-protected-paths",
    );
    expect(guardDecision(edit("/repo/db/schema.sql"), REPO, db)).toEqual({
      decision: { deny: false },
      run: null,
    });
  });
});

describe("formatGuardOutput", () => {
  const denyPayload = {
    hookEventName: "PreToolUse",
    permissionDecision: "deny",
    permissionDecisionReason: "nope",
  };

  it("returns null when the edit is allowed and logging succeeded", () => {
    expect(formatGuardOutput({ deny: false })).toBeNull();
  });

  it("emits just the deny decision when logging succeeded", () => {
    expect(
      JSON.parse(formatGuardOutput({ deny: true, reason: "nope" }) as string),
    ).toEqual({ hookSpecificOutput: denyPayload });
  });

  it("adds a visible systemMessage when the audit write failed", () => {
    const out = JSON.parse(
      formatGuardOutput({ deny: true, reason: "nope" }, "boom") as string,
    );
    expect(out.hookSpecificOutput).toEqual(denyPayload);
    expect(out.systemMessage).toContain("audit logging failed");
    expect(out.systemMessage).toContain("boom");
  });

  it("surfaces an audit failure even when the edit was allowed", () => {
    const out = JSON.parse(
      formatGuardOutput({ deny: false }, "boom") as string,
    );
    expect(out.hookSpecificOutput).toBeUndefined();
    expect(out.systemMessage).toContain("boom");
  });
});

describe("tool-stage guard invariant", () => {
  it("keeps lint-protected-paths tool-staged — the only rule guardDecision enforces", () => {
    const toolStaged = RULES.filter((r) => r.meta.stages.includes("tool")).map(
      (r) => r.meta.slug,
    );
    expect(toolStaged).toContain("lint-protected-paths");
  });
});
